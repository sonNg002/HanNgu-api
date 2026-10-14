import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApiServer } from '../../src/app.js';
import { readConfig } from '../../src/config/env.js';
import type { AddressInfo } from 'node:net';
import type { SyncWrite } from '../../src/types/sync.js';

// Chạy qua `npm run test:emulator`; Firebase CLI đặt hai biến host. readConfig chỉ nhận project demo-.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-hanngu';
interface EmulatorUser { localId: string; idToken: string }

test('API thật qua emulator: Auth, phân trang, settings, retry log, LWW và cách ly tài khoản', { skip: !authHost || !firestoreHost ? 'Cần chạy trong Firebase emulator.' : false }, async () => {
  const server = createApiServer({ config: readConfig({ ...process.env, NODE_ENV: 'test', FIREBASE_PROJECT_ID: project }), logger: () => {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const users: EmulatorUser[] = [];
  const cardIds = Array.from({ length: 201 }, (_, index) => `write:字-${index}`);
  const reviewId = crypto.randomUUID();
  const auth = async <T>(method: string, body: unknown): Promise<T> => {
    const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data as T;
  };
  const signup = async () => {
    const user = await auth<EmulatorUser>('signUp', { email: `qa-api-${crypto.randomUUID()}@example.test`, password: 'DemoTesting123!', returnSecureToken: true });
    users.push(user);
    return user;
  };
  const call = async (user: EmulatorUser, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${user.idToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const first = await signup();
    const second = await signup();
    const cards = cardIds.map((id, index): Extract<SyncWrite, { collection: 'cards' }> => ({ collection: 'cards', id, data: {
      id, type: 'write', targetId: `字-${index}`, mnemonic: '', introducedAt: 1000, updatedAt: 1000, revision: `revision-${index}`,
      fsrs: { due: 1000, reps: 0, lapses: 0, state: 0, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0 },
    } }));
    const review: Extract<SyncWrite, { collection: 'reviews' }> = { collection: 'reviews', id: reviewId, data: {
      id: reviewId, type: 'write', targetId: '字-0', cardId: cards[0].id, rating: 3, durationMs: 1200, reviewedAt: 1000,
      updatedAt: 1000, revision: reviewId, fsrsLog: { due: 1000, review: 1000 },
    } };
    const settings: Extract<SyncWrite, { collection: 'settings' }> = { collection: 'settings', id: 'main', data: {
      id: 'main', newPerDay: 10, order: 'freq', updatedAt: 1000, revision: 'settings',
    } };
    assert.equal((await call(first, '/v1/sync/batch', { writes: [...cards, review, settings] })).status, 200);

    const page = await call(first, '/v1/sync/cards?since=0');
    assert.equal(page.status, 200);
    assert.equal(page.data.documents.length, 200);
    assert.equal(typeof page.data.documents[0].serverUpdatedAt, 'number');
    const next = await call(first, `/v1/sync/cards?since=0&cursor=${encodeURIComponent(JSON.stringify(page.data.next))}`);
    assert.equal(next.status, 200);
    assert.equal(next.data.documents.length, 1);
    assert.equal(next.data.next, undefined);
    assert.equal(new Set([...page.data.documents, ...next.data.documents].map((item: { id: string }) => item.id)).size, 201);
    assert.equal((await call(first, '/v1/sync/settings')).data.settings.newPerDay, 10);

    // Retry cùng log được phép; sửa nội dung log đã ghi bị rules từ chối.
    assert.equal((await call(first, '/v1/sync/batch', { writes: [review] })).status, 200);
    assert.equal((await call(first, '/v1/sync/reviews?since=0')).data.documents.length, 1);
    assert.equal((await call(first, '/v1/sync/batch', { writes: [{ ...review, data: { ...review.data, rating: 4 } }] })).status, 403);
    // LWW: bản cũ hơn không ghi đè thẻ hoặc settings; bản mới hơn được nhận.
    assert.equal((await call(first, '/v1/sync/batch', { writes: [{ ...cards[0], data: { ...cards[0].data, updatedAt: 999 } }] })).status, 403);
    assert.equal((await call(first, '/v1/sync/batch', { writes: [{ ...settings, data: { ...settings.data, newPerDay: 3, updatedAt: 999 } }] })).status, 403);
    assert.equal((await call(first, '/v1/sync/batch', { writes: [{ ...cards[0], data: { ...cards[0].data, mnemonic: 'mới', updatedAt: 2000, revision: 'r2' } }] })).status, 200);
    const updated = await call(first, `/v1/sync/cards?since=${page.data.documents[0].serverUpdatedAt + 1}`);
    assert.ok(updated.data.documents.some((item: { id: string; data: { mnemonic: string } }) => item.id === cards[0].id && item.data.mnemonic === 'mới'));
    // Commit nguyên tử: một write bị từ chối thì cả batch không được ghi.
    const fresh = { ...cards[1], id: 'write:mới', data: { ...cards[1].data, id: 'write:mới', targetId: 'mới' } };
    assert.equal((await call(first, '/v1/sync/batch', { writes: [fresh, { ...cards[2], data: { ...cards[2].data, updatedAt: 1 } }] })).status, 403);
    const all = await call(first, '/v1/sync/cards?since=0');
    assert.ok(!all.data.documents.some((item: { id: string }) => item.id === 'write:mới'));

    // UID chỉ lấy từ token: tài khoản khác không đọc hoặc ghi được dữ liệu của người đầu.
    assert.equal((await call(second, `/v1/sync/cards?since=0&uid=${first.localId}`)).status, 400);
    assert.equal((await call(second, '/v1/sync/cards?since=0')).data.documents.length, 0);
    assert.equal((await call(second, '/v1/sync/settings')).data.settings, null);
    assert.equal((await call(second, '/v1/sync/batch', { uid: first.localId, writes: [settings] })).status, 400);
  } finally {
    // Chỉ xóa dữ liệu của các UID do bài thử tạo; token "owner" là quyền quản trị của emulator.
    for (const user of users) {
      const paths = [`users/${user.localId}`, `users/${user.localId}/reviews/${reviewId}`, `users/${user.localId}/cards/write:mới`,
        ...cardIds.map(id => `users/${user.localId}/cards/${id}`)];
      for (let offset = 0; offset < paths.length; offset += 40) {
        await Promise.all(paths.slice(offset, offset + 40).map(path => fetch(
          `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path.split('/').map(encodeURIComponent).join('/')}`,
          { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })));
      }
      await auth('delete', { idToken: user.idToken });
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
