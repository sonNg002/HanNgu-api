import { ApiError, requireValue } from '../errors/api-error.js';
import { encodeValue, decodeFields } from '../mappers/firestore.mapper.js';
import { isSafeId, PAGE_SIZE } from '../validators/sync.validator.js';
import type { FirestoreValue } from '../mappers/firestore.mapper.js';
import type { PageCursor, RemoteCard, RemotePage, RemoteReview, RemoteSettings, SyncCollection, SyncRepository, SyncWrite } from '../types/sync.js';
interface FirestoreDocument { name: string; fields: Record<string, FirestoreValue> }
interface RepositoryOptions { emulatorHost?: string; fetcher?: typeof fetch; timeoutMs?: number }

const upstreamErrors: Record<string, [number, string, string]> = {
  NOT_FOUND: [404, 'Chưa có dữ liệu.', 'NOT_FOUND'],
  UNAUTHENTICATED: [401, 'Phiên đăng nhập đã hết hạn.', 'UNAUTHENTICATED'],
  PERMISSION_DENIED: [403, 'Firestore từ chối thao tác. Đồng bộ lại để nhận bản mới hoặc kiểm tra rules.', 'FIRESTORE_PERMISSION_DENIED'],
  RESOURCE_EXHAUSTED: [429, 'Đã đạt hạn mức Firestore.', 'UPSTREAM_RATE_LIMITED'],
  FAILED_PRECONDITION: [503, 'Firestore chưa sẵn sàng; kiểm tra indexes.', 'UPSTREAM_NOT_READY'],
};

export class FirestoreRepository implements SyncRepository {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly base: string;
  private readonly database: string;
  constructor(readonly project: string, { emulatorHost, fetcher = fetch, timeoutMs = 20000 }: RepositoryOptions = {}) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.base = emulatorHost ? `http://${emulatorHost}/v1` : 'https://firestore.googleapis.com/v1';
    this.database = `projects/${project}/databases/(default)`;
  }
  userPath(uid: string): string {
    requireValue(isSafeId(uid), 'UID không hợp lệ.');
    return `${this.database}/documents/users/${uid}`;
  }
  private async request<T>(path: string, token: string, body?: unknown): Promise<T> {
    let response: Response;
    let result: unknown;
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/').replace(/%3A(runQuery|commit)$/, ':$1');
      response = await this.fetcher(`${this.base}/${encodedPath}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new ApiError(504, 'Firestore phản hồi quá lâu.', 'UPSTREAM_TIMEOUT');
      throw new ApiError(502, 'Không kết nối được Firestore.', 'UPSTREAM_UNAVAILABLE');
    }
    try { result = await response.json(); }
    catch { throw new ApiError(502, 'Firestore trả về dữ liệu không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE'); }
    if (result === null || typeof result !== 'object') throw new ApiError(502, 'Firestore trả về dữ liệu không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE');
    if (!response.ok) {
      const errorResult = result as { error?: { status?: string } };
      const mapped = upstreamErrors[errorResult.error?.status ?? ''];
      if (mapped) throw new ApiError(...mapped);
      throw new ApiError(response.status >= 500 ? 502 : 400, 'Firestore không xử lý được yêu cầu.', 'UPSTREAM_ERROR');
    }
    return result as T;
  }
  async readSettings(uid: string, token: string): Promise<RemoteSettings | null> {
    try {
      const data = decodeFields((await this.request<FirestoreDocument>(this.userPath(uid), token)).fields);
      if (!data.settings) return null;
      if (typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new ApiError(502, 'Firestore trả về settings không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE');
      return { ...data.settings, id: 'main', updatedAt: data.updatedAt, revision: data.revision } as unknown as RemoteSettings;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
  async readPage(uid: string, token: string, collection: SyncCollection, since: number, cursor?: PageCursor): Promise<RemotePage> {
    const parent = this.userPath(uid);
    const query: Record<string, unknown> = {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: 'serverUpdatedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(since).toISOString() } } },
      orderBy: [{ field: { fieldPath: 'serverUpdatedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: PAGE_SIZE,
    };
    if (cursor) query.startAt = { before: false, values: [
      { timestampValue: cursor.timestamp }, { referenceValue: `${parent}/${collection}/${cursor.id}` },
    ] };
    const rows = await this.request<{ document?: FirestoreDocument }[]>(`${parent}:runQuery`, token, { structuredQuery: query });
    if (!Array.isArray(rows)) throw new ApiError(502, 'Firestore trả về trang không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE');
    const snapshots = rows.flatMap(row => row.document ? [row.document] : []);
    const documents = snapshots.map(snapshot => {
      const { serverUpdatedAt, ...data } = decodeFields(snapshot.fields);
      const time = typeof serverUpdatedAt === 'string' ? Date.parse(serverUpdatedAt) : NaN;
      if (!Number.isFinite(time)) throw new ApiError(502, 'Firestore trả về timestamp không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE');
      return { id: snapshot.name.split('/').at(-1)!, data: data as unknown as RemoteCard | RemoteReview, serverUpdatedAt: time };
    });
    const last = snapshots.at(-1);
    return { documents, ...(last && snapshots.length === PAGE_SIZE ? {
      next: { id: last.name.split('/').at(-1)!, timestamp: (last.fields.serverUpdatedAt as { timestampValue: string }).timestampValue },
    } : {}) };
  }
  async commit(uid: string, token: string, writes: SyncWrite[]): Promise<void> {
    const parent = this.userPath(uid);
    const operations = writes.map(write => {
      const data = write.collection === 'settings'
        ? { settings: { newPerDay: write.data.newPerDay, order: write.data.order }, updatedAt: write.data.updatedAt, revision: write.data.revision }
        : write.data;
      const encoded = encodeValue(data);
      if (!('mapValue' in encoded)) throw new ApiError(400, 'Write phải là object.', 'VALIDATION_ERROR');
      return {
        update: { name: write.collection === 'settings' ? parent : `${parent}/${write.collection}/${write.id}`, fields: encoded.mapValue.fields },
        updateTransforms: [{ fieldPath: 'serverUpdatedAt', setToServerValue: 'REQUEST_TIME' }],
      };
    });
    // Token người dùng giữ Security Rules; commit nguyên tử giữ giao thức ack của frontend.
    await this.request(`${this.database}/documents:commit`, token, { writes: operations });
  }
}
