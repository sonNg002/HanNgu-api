import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config/env.js';
import { validateBatch, validatePage } from '../src/validators/sync.validator.js';
import { createRateLimiter } from '../src/middleware/rate-limit.js';
import { ApiError } from '../src/errors/api-error.js';
import { cardWrite, reviewWrite, settingsWrite } from './helpers.js';

test('Config từ chối port/origin sai và emulator production; default bind phù hợp môi trường', () => {
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(readConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' }).host, '0.0.0.0');
  for (const env of [{ PORT: 'NaN' }, { PORT: '0' }, { PORT: '65536' }, { NODE_ENV: 'production' },
    { CORS_ORIGINS: '*' }, { CORS_ORIGINS: 'https://app.example.com/path' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'http://app.example.com' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
    { FIREBASE_PROJECT_ID: 'hanngu-91a22', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099', FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com', FIREBASE_PROJECT_ID: 'demo-hanngu', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }]) {
    assert.throws(() => readConfig(env));
  }
});

test('Batch chấp nhận wire format hiện tại, chặn path/UID/metadata sai và writes trùng', () => {
  assert.equal(validateBatch({ writes: [settingsWrite(), cardWrite(), reviewWrite()] }).length, 3);
  const invalid: unknown[] = [
    { writes: [] }, { writes: Array(451).fill(settingsWrite()) },
    { writes: [settingsWrite(), settingsWrite()] }, { writes: [settingsWrite()], uid: 'victim' },
    { writes: [{ ...settingsWrite(), id: '../victim' }] },
    { writes: [{ ...settingsWrite(), collection: '../users' }] },
  ];
  for (const field of ['dirty', 'serverUpdatedAt', 'uid']) invalid.push({ writes: [{ ...cardWrite(), data: { ...cardWrite().data, [field]: 1 } }] });
  for (const value of [-1, Infinity, NaN, 0.5, '1000']) invalid.push({ writes: [{ ...cardWrite(), data: { ...cardWrite().data, updatedAt: value } }] });
  invalid.push({ writes: [{ ...reviewWrite(), data: { ...reviewWrite().data, fsrsLog: null } }] });
  invalid.push({ writes: [{ ...cardWrite(), data: { ...cardWrite().data, targetId: 'other' } }] });
  for (const body of invalid) assert.throws(() => validateBatch(body));
});

test('Cursor giữ nano, từ chối query lặp, path injection và since ngoài giới hạn', () => {
  const cursor = { id: 'write:字', timestamp: '2026-10-11T12:00:00.123456789Z' };
  const page = validatePage('cards', new URLSearchParams({ since: '0', cursor: JSON.stringify(cursor) }));
  assert.deepEqual(page, { collection: 'cards', since: 0, cursor });
  for (const query of ['since=-1', 'since=1.5', 'since=9007199254740991', 'since=0&since=1', 'uid=victim', 'cursor=null',
    'cursor=' + encodeURIComponent(JSON.stringify({ ...cursor, id: '../victim' }))]) {
    assert.throws(() => validatePage('cards', new URLSearchParams(query)));
  }
});

test('Rate limiter reset cửa sổ và giới hạn kích thước Map', () => {
  let time = 1000;
  const limit = createRateLimiter({ maxRequests: 1, windowMs: 1000, maxKeys: 1, now: () => time });
  limit('first');
  assert.throws(() => limit('first'), error => error instanceof ApiError && error.status === 429);
  assert.throws(() => limit('second'), error => error instanceof ApiError && error.status === 503);
  time = 2000;
  assert.doesNotThrow(() => limit('second'));
});
