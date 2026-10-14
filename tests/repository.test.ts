import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FirestoreRepository } from '../src/repositories/firestore.repository.js';
import { encodeValue, decodeValue } from '../src/mappers/firestore.mapper.js';
import { settingsWrite, cardWrite } from './helpers.js';
import { ApiError } from '../src/errors/api-error.js';

test('Firestore mapper giữ số, nested objects, array; chặn giá trị không phải JSON', () => {
  const value = { due: 1234567, stability: 2.31, nil: null, enabled: true, chars: ['明'], state: { reps: 4 } };
  assert.deepEqual(decodeValue(encodeValue(value)), value);
  for (const invalid of [NaN, Infinity, undefined, new Date()]) assert.throws(() => encodeValue(invalid));
});

test('Phân trang giữ timestamp nano và chuyển token người dùng', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const timestamp = '2026-10-11T12:00:00.123456789Z';
  const repository = new FirestoreRepository('demo-hanngu', { fetcher: async (url, options) => {
    calls.push({ url: String(url), options: options ?? {} });
    return Response.json(Array.from({ length: 200 }, (_, i) => ({ document: {
      name: `projects/demo-hanngu/databases/(default)/documents/users/owner/cards/write:字${i}`,
      fields: { id: { stringValue: `write:字${i}` }, serverUpdatedAt: { timestampValue: timestamp } },
    } })));
  } });
  const first = await repository.readPage('owner', 'token', 'cards', 0);
  assert.equal(first.documents.length, 200);
  assert.equal(first.next!.timestamp, timestamp);
  await repository.readPage('owner', 'token', 'cards', 0, first.next);
  const query = JSON.parse(String(calls[1].options.body)).structuredQuery;
  assert.equal(query.startAt.values[0].timestampValue, timestamp);
  assert.equal(new Headers(calls[1].options.headers).get('Authorization'), 'Bearer token');
});

test('Commit batch nguyên tử, đặt REQUEST_TIME và ghi settings vào users/{uid}', async () => {
  let call: { url: string; options: RequestInit } | undefined;
  const repository = new FirestoreRepository('demo-hanngu', { fetcher: async (url, options) => { call = { url: String(url), options: options ?? {} }; return Response.json({}); } });
  await repository.commit('owner', 'token', [settingsWrite(), cardWrite()]);
  assert.ok(call);
  const writes = JSON.parse(String(call.options.body)).writes;
  assert.equal(writes.length, 2);
  assert.equal(writes[0].update.name, 'projects/demo-hanngu/databases/(default)/documents/users/owner');
  assert.equal(writes[1].update.name, 'projects/demo-hanngu/databases/(default)/documents/users/owner/cards/write:字');
  assert.equal(writes[0].updateTransforms[0].setToServerValue, 'REQUEST_TIME');
  assert.equal(new Headers(call.options.headers).get('Authorization'), 'Bearer token');
});

test('Missing settings là null; upstream timeout/network/permission giữ lỗi riêng', async () => {
  for (const [status, expected] of [['NOT_FOUND', 404], ['PERMISSION_DENIED', 403], ['RESOURCE_EXHAUSTED', 429], ['FAILED_PRECONDITION', 503]]) {
    const repository = new FirestoreRepository('demo-hanngu', { fetcher: async () => Response.json({ error: { status } }, { status: 400 }) });
    if (expected === 404) assert.equal(await repository.readSettings('owner', 'token'), null);
    else await assert.rejects(repository.readSettings('owner', 'token'), error => error instanceof ApiError && error.status === expected);
  }
  for (const [name, expected] of [['TimeoutError', 504], ['TypeError', 502]]) {
    const repository = new FirestoreRepository('demo-hanngu', { fetcher: async () => { throw Object.assign(new Error('secret'), { name }); } });
    await assert.rejects(repository.readSettings('owner', 'token'), error => error instanceof ApiError && error.status === expected && !error.message.includes('secret'));
  }
});

test('Path UID được encode; response JSON lỗi không trở thành lỗi nội bộ', async () => {
  let url = '';
  const repository = new FirestoreRepository('demo-hanngu', { fetcher: async value => { url = String(value); return Response.json({}); } });
  await repository.readSettings('owner?#%', 'token');
  assert.ok(url.endsWith('/owner%3F%23%25'));
  for (const response of [new Response('not json'), Response.json(null)]) {
    const invalid = new FirestoreRepository('demo-hanngu', { fetcher: async () => response });
    await assert.rejects(invalid.readSettings('owner', 'token'), error => error instanceof ApiError && error.status === 502 && error.code === 'UPSTREAM_INVALID_RESPONSE');
  }
});
