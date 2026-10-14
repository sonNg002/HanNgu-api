import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/errors/api-error.js';
import { settingsWrite, withApi } from './helpers.js';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

test('Health không cần token; request ID có trên success và lỗi', async t => {
  const { call } = await withApi(t);
  const health = await call('/health', { headers: { Authorization: '' } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.match(health.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/);
  const denied = await call('/v1/sync/settings', { headers: { Authorization: '' } });
  assert.equal(denied.status, 401);
  const body = await denied.json();
  assert.equal(body.code, 'UNAUTHENTICATED');
  assert.equal(body.requestId, denied.headers.get('x-request-id'));
});

test('Token sai/UID không hợp lệ bị chặn; service chỉ nhận UID đã xác thực', async t => {
  const { call, calls } = await withApi(t);
  assert.equal((await call('/v1/sync/settings', { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  assert.equal((await call('/v1/sync/settings')).status, 200);
  assert.deepEqual(calls, [['settings', 'owner', 'valid']]);
  const invalid = await withApi(t, { verifyToken: async () => ({ uid: '../victim' }) });
  assert.equal((await invalid.call('/v1/sync/settings')).status, 401);
});

test('Lỗi hạ tầng Firebase Auth trả 503 để client không refresh token vô ích', async t => {
  const api = await withApi(t, { verifyToken: async () => { throw Object.assign(new Error('secret'), { code: 'auth/internal-error' }); } });
  const response = await api.call('/v1/sync/settings');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AUTH_UNAVAILABLE');
});

test('CORS kiểm origin và preflight method/header, kể cả khi request chưa có token', async t => {
  const { call } = await withApi(t);
  assert.equal((await call('/health', { headers: { Origin: 'https://unknown.test' } })).status, 403);
  const preflight = await call('/v1/sync/batch', { method: 'OPTIONS', headers: {
    Authorization: '', Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(preflight.headers.get('vary'), 'Origin');
  assert.equal((await call('/v1/sync/batch', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'X-Unsafe' } })).status, 403);
  assert.equal((await call('/v1/sync/batch', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 405);
});

test('Route sai trả 404; method sai trả 405 và Allow', async t => {
  const { call } = await withApi(t);
  assert.equal((await call('/v1/unknown')).status, 404);
  const response = await call('/v1/sync/settings', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('Batch valid chuyển nguyên nội dung; không cho body chọn UID', async t => {
  const { call, calls } = await withApi(t);
  const writes = [settingsWrite()];
  const response = await call('/v1/sync/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls, [['commit', 'owner', 'valid', writes]]);
  const rejected = await call('/v1/sync/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes, uid: 'victim' }) });
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 1);
});

test('Body sai JSON, media type, payload hoặc encoding bị từ chối', async t => {
  const { call, calls } = await withApi(t, { env: { BODY_LIMIT_BYTES: '1024' } });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  assert.equal((await call('/v1/sync/batch', { ...options, body: '{' })).status, 400);
  assert.equal((await call('/v1/sync/batch', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await call('/v1/sync/batch', { ...options, body: ' '.repeat(1025) })).status, 413);
  assert.equal((await call('/v1/sync/batch', { ...options, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: '{}' })).status, 415);
  assert.equal(calls.length, 0);
});

test('Body chunked vượt giới hạn vẫn trả HTTP 413 thay vì ngắt socket đột ngột', async t => {
  const { server, calls } = await withApi(t, { env: { BODY_LIMIT_BYTES: '1024' } });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port,
      path: '/v1/sync/batch', method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject);
    request.write(' '.repeat(600));
    request.end(' '.repeat(600));
  });
  assert.equal(status, 413);
  assert.equal(calls.length, 0);
});

test('HTTP page chuyển since và cursor nano qua service; query sai không gọi repository', async t => {
  const { call, calls } = await withApi(t);
  const cursor = { id: 'write:字', timestamp: '2026-10-11T12:00:00.123456789Z' };
  const query = new URLSearchParams({ since: '1000', cursor: JSON.stringify(cursor) });
  assert.equal((await call('/v1/sync/cards?' + query)).status, 200);
  assert.deepEqual(calls, [['page', 'owner', 'valid', 'cards', 1000, cursor]]);
  assert.equal((await call('/v1/sync/reviews?since=-1')).status, 400);
  assert.equal(calls.length, 1);
});

test('Lỗi nội bộ không lộ token; lỗi upstream giữ status/code', async t => {
  const { call, logs } = await withApi(t, { repository: { readSettings: async () => { throw new Error('Bearer SECRET'); } } });
  const response = await call('/v1/sync/settings');
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
  const upstream = await withApi(t, { repository: { readSettings: async () => { throw new ApiError(503, 'Unavailable', 'UPSTREAM_NOT_READY'); } } });
  assert.equal((await upstream.call('/v1/sync/settings')).status, 503);
});

test('Rate limit có Retry-After; không tin X-Forwarded-For của client', async t => {
  const { call } = await withApi(t, { env: { RATE_LIMIT_MAX: '1' } });
  assert.equal((await call('/v1/sync/settings')).status, 200);
  const denied = await call('/v1/sync/settings', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.equal((await call('/health')).status, 200);
});
