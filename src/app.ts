import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readConfig } from './config/env.js';
import { createFirebaseTokenVerifier } from './config/firebase.js';
import { SyncController } from './controllers/sync.controller.js';
import { ApiError } from './errors/api-error.js';
import { sendJson } from './http/json.js';
import { authenticate } from './middleware/auth.js';
import { applyCors } from './middleware/cors.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { FirestoreRepository } from './repositories/firestore.repository.js';
import { createSyncRouter } from './routes/sync.routes.js';
import { SyncService } from './services/sync.service.js';
import type { AppConfig } from './config/env.js';
import type { Logger, TokenVerifier } from './types/http.js';
import type { SyncRepository } from './types/sync.js';
export interface ApiServerOptions {
  config?: AppConfig;
  repository?: SyncRepository;
  verifyToken?: TokenVerifier;
  logger?: Logger;
}

export function createApiServer({ config = readConfig(), repository, verifyToken, logger = entry => console.log(JSON.stringify(entry)) }: ApiServerOptions = {}) {
  repository ??= new FirestoreRepository(config.project, { emulatorHost: config.firestoreEmulator, timeoutMs: config.upstreamTimeoutMs });
  verifyToken ??= createFirebaseTokenVerifier(config.project);
  const router = createSyncRouter(new SyncController(new SyncService(repository), config.bodyLimitBytes));
  const limit = createRateLimiter({ maxRequests: config.rateLimitMax, windowMs: config.rateLimitWindowMs });
  const log: Logger = entry => { try { logger(entry); } catch { /* Logging không được làm hỏng request. */ } };
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    let path = '/';
    response.setHeader('X-Request-ID', requestId);
    response.once('finish', () => log({ event: 'http.request', requestId, method: request.method, path, status: response.statusCode, durationMs: Math.round(performance.now() - started) }));
    try {
      let url;
      try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { throw new ApiError(400, 'URL không hợp lệ.', 'INVALID_URL'); }
      path = url.pathname;
      if (applyCors(request, response, config.origins)) return;
      if (path === '/health') {
        if (request.method !== 'GET') throw new ApiError(405, 'Method không được hỗ trợ.', 'METHOD_NOT_ALLOWED', { headers: { Allow: 'GET' } });
        sendJson(response, 200, { ok: true, project: config.project });
        return;
      }
      const handler = router(request.method, path);
      // Chỉ tin địa chỉ socket. Proxy nhiều replica cần rate limit tại gateway.
      limit(request.socket.remoteAddress || 'unknown');
      const actor = await authenticate(request, verifyToken);
      await handler({ request, response, actor, url, requestId });
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.end(); return; }
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      if (error instanceof ApiError) for (const [key, value] of Object.entries(error.headers)) response.setHeader(key, value);
      if (status >= 500) log({ event: 'http.error', requestId, status, code, errorType: error instanceof Error ? error.name : 'Error' });
      // Giữ error dạng string tương thích frontend cũ; bổ sung code và requestId.
      sendJson(response, status, { error: error instanceof ApiError ? error.message : 'Server gặp lỗi. Hãy thử lại.', code, requestId });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
