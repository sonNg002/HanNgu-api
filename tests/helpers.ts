import { once } from 'node:events';
import { createApiServer } from '../src/app.js';
import { readConfig } from '../src/config/env.js';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { TokenVerifier } from '../src/types/http.js';
import type { SyncRepository, SyncWrite } from '../src/types/sync.js';

export const settingsWrite = (): Extract<SyncWrite, { collection: 'settings' }> => ({ collection: 'settings', id: 'main', data: {
  id: 'main', newPerDay: 10, order: 'freq', updatedAt: 1000, revision: 'settings-revision',
} });
export const cardWrite = (): Extract<SyncWrite, { collection: 'cards' }> => ({ collection: 'cards', id: 'write:字', data: {
  id: 'write:字', type: 'write', targetId: '字', mnemonic: '', introducedAt: 1000, updatedAt: 1000, revision: 'card-revision',
  fsrs: { due: 1000, reps: 0, stability: 0, difficulty: 0, state: 0, lapses: 0, learning_steps: 0, elapsed_days: 0, scheduled_days: 0 },
} });
export const reviewWrite = (): Extract<SyncWrite, { collection: 'reviews' }> => ({ collection: 'reviews', id: 'review-id', data: {
  id: 'review-id', type: 'write', targetId: '字', cardId: 'write:字', rating: 3, reviewedAt: 1000, durationMs: 1000,
  updatedAt: 1000, revision: 'review-revision', fsrsLog: { due: 1000, review: 1000, rating: 3 },
} });

export async function withApi(testContext: TestContext, overrides: {
  repository?: Partial<SyncRepository>; env?: Record<string, string>; verifyToken?: TokenVerifier;
} = {}) {
  const calls: unknown[][] = [];
  const logs: Readonly<Record<string, unknown>>[] = [];
  const repository: SyncRepository = {
    readSettings: async (...args: Parameters<SyncRepository['readSettings']>) => { calls.push(['settings', ...args]); return null; },
    readPage: async (...args: Parameters<SyncRepository['readPage']>) => { calls.push(['page', ...args]); return { documents: [] }; },
    commit: async (...args: Parameters<SyncRepository['commit']>) => { calls.push(['commit', ...args]); },
    ...overrides.repository,
  };
  const server = createApiServer({
    config: readConfig({ NODE_ENV: 'test', ...overrides.env }), repository, logger: entry => logs.push(entry),
    verifyToken: overrides.verifyToken || (async token => { if (token !== 'valid') throw new Error('secret-token'); return { uid: 'owner' }; }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  testContext.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer valid');
    return fetch(base + path, { ...options, headers });
  };
  return { server, call, calls, logs };
}
