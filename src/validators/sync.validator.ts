import { requireValue } from '../errors/api-error.js';
import type { PageCursor, SyncCollection, SyncWrite } from '../types/sync.js';

export const MAX_BATCH_OPERATIONS = 450;
export const PAGE_SIZE = 200;
const types = ['recognize', 'write', 'recall-hv'];
export const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
export const isSafeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1500 && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validatePage(collection: SyncCollection, params: URLSearchParams): { collection: SyncCollection; since: number; cursor?: PageCursor } {
  requireValue(['cards', 'reviews'].includes(collection), 'Collection không hợp lệ.');
  for (const key of params.keys()) requireValue(['since', 'cursor'].includes(key) && params.getAll(key).length === 1, 'Query không hợp lệ.');
  const rawSince = params.get('since') ?? '0';
  requireValue(/^\d+$/.test(rawSince) && timestamp(Number(rawSince)), 'since không hợp lệ.');
  let cursor: unknown;
  if (params.has('cursor')) {
    const rawCursor = params.get('cursor')!;
    requireValue(rawCursor.length <= 4096, 'Cursor quá dài.');
    try { cursor = JSON.parse(rawCursor); } catch { requireValue(false, 'Cursor không hợp lệ.'); }
    requireValue(isPlainObject(cursor) && Object.keys(cursor).every(key => ['id', 'timestamp'].includes(key)) && isSafeId(cursor.id)
      && typeof cursor.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(cursor.timestamp)
      && Number.isFinite(Date.parse(cursor.timestamp)), 'Cursor không hợp lệ.');
  }
  return { collection, since: Number(rawSince), ...(cursor ? { cursor: cursor as PageCursor } : {}) };
}

export function validateBatch(body: unknown): SyncWrite[] {
  requireValue(isPlainObject(body) && Object.keys(body).length === 1 && Object.hasOwn(body, 'writes'), 'Body chỉ chứa writes.');
  const { writes } = body;
  requireValue(Array.isArray(writes) && writes.length >= 1 && writes.length <= MAX_BATCH_OPERATIONS, 'Batch phải có từ 1 đến 450 thao tác.');
  const seen = new Set();
  for (const write of writes) {
    requireValue(isPlainObject(write) && Object.keys(write).length === 3 && Object.keys(write).every(key => ['collection', 'id', 'data'].includes(key)), 'Write chỉ chứa collection, id, data.');
    requireValue(typeof write.collection === 'string' && ['settings', 'cards', 'reviews'].includes(write.collection) && isSafeId(write.id), 'Collection hoặc ID không hợp lệ.');
    const key = `${write.collection}:${write.id}`;
    requireValue(!seen.has(key), 'Không ghi trùng document trong cùng batch.');
    seen.add(key);
    const data = write.data;
    requireValue(isPlainObject(data) && data.id === write.id && timestamp(data.updatedAt) && typeof data.revision === 'string'
      && data.revision.length > 0 && data.revision.length <= 256, 'Metadata đồng bộ không hợp lệ.');
    const common = ['id', 'updatedAt', 'revision'];
    const allowed = write.collection === 'settings' ? [...common, 'newPerDay', 'order']
      : write.collection === 'cards' ? [...common, 'type', 'targetId', 'mnemonic', 'introducedAt', 'fsrs']
      : [...common, 'type', 'targetId', 'cardId', 'rating', 'reviewedAt', 'durationMs', 'fsrsLog', 'writing'];
    requireValue(Object.keys(data).every(key => allowed.includes(key)), 'Dữ liệu có trường không được cho phép.');
    if (write.collection === 'settings') {
      requireValue(write.id === 'main' && typeof data.newPerDay === 'number' && Number.isInteger(data.newPerDay) && data.newPerDay >= 1 && data.newPerDay <= 50 && typeof data.order === 'string' && ['hsk', 'freq'].includes(data.order), 'Settings không hợp lệ.');
      continue;
    }
    requireValue(typeof data.type === 'string' && types.includes(data.type) && isSafeId(data.targetId), 'Thẻ không hợp lệ.');
    if (write.collection === 'cards') {
      requireValue(data.id === `${data.type}:${data.targetId}` && typeof data.mnemonic === 'string' && data.mnemonic.length <= 2000
        && timestamp(data.introducedAt) && isPlainObject(data.fsrs) && timestamp(data.fsrs.due)
        && typeof data.fsrs.reps === 'number' && Number.isInteger(data.fsrs.reps) && data.fsrs.reps >= 0, 'Nội dung thẻ không hợp lệ.');
      requireValue(Object.entries(data.fsrs).every(([key, value]) => ['due', 'last_review'].includes(key) ? timestamp(value) : number(value)), 'FSRS không hợp lệ.');
    } else {
      requireValue(data.cardId === `${data.type}:${data.targetId}` && typeof data.rating === 'number' && Number.isInteger(data.rating) && data.rating >= 1 && data.rating <= 4
        && timestamp(data.reviewedAt) && number(data.durationMs) && data.durationMs >= 0 && isPlainObject(data.fsrsLog)
        && timestamp(data.fsrsLog.due) && timestamp(data.fsrsLog.review), 'Log ôn không hợp lệ.');
      requireValue(Object.entries(data.fsrsLog).every(([key, value]) => ['due', 'review'].includes(key) ? timestamp(value) : number(value)), 'FSRS log không hợp lệ.');
      if (data.writing !== undefined) requireValue(isPlainObject(data.writing) && Object.keys(data.writing).every(key => ['strokeCount', 'totalMistakes', 'usedHint'].includes(key))
        && typeof data.writing.strokeCount === 'number' && Number.isInteger(data.writing.strokeCount) && data.writing.strokeCount > 0 && typeof data.writing.totalMistakes === 'number' && Number.isInteger(data.writing.totalMistakes)
        && data.writing.totalMistakes >= 0 && typeof data.writing.usedHint === 'boolean', 'Kết quả viết không hợp lệ.');
    }
  }
  // Boundary duy nhất nhận JSON unknown; toàn bộ writes đã được kiểm tra phía trên.
  return writes as SyncWrite[];
}
