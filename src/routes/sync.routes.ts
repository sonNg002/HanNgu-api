import { ApiError } from '../errors/api-error.js';
import type { SyncController } from '../controllers/sync.controller.js';
import type { RequestContext } from '../types/http.js';
type Handler = (context: RequestContext) => Promise<void>;

export function createSyncRouter(controller: SyncController) {
  const routes = new Map<string, { method: string; handler: Handler }>([
    ['/v1/sync/settings', { method: 'GET', handler: context => controller.settings(context) }],
    ['/v1/sync/cards', { method: 'GET', handler: context => controller.page(context, 'cards') }],
    ['/v1/sync/reviews', { method: 'GET', handler: context => controller.page(context, 'reviews') }],
    ['/v1/sync/batch', { method: 'POST', handler: context => controller.batch(context) }],
  ]);
  return (method: string | undefined, path: string): Handler => {
    const route = routes.get(path);
    if (!route) throw new ApiError(404, 'Endpoint không tồn tại.', 'NOT_FOUND');
    if (route.method !== method) throw new ApiError(405, 'Method không được hỗ trợ.', 'METHOD_NOT_ALLOWED', { headers: { Allow: route.method } });
    return route.handler;
  };
}
