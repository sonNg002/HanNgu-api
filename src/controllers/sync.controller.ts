import { readJson, sendJson } from '../http/json.js';
import type { SyncService } from '../services/sync.service.js';
import type { RequestContext } from '../types/http.js';
import type { SyncCollection } from '../types/sync.js';

export class SyncController {
  constructor(private readonly service: SyncService, private readonly bodyLimitBytes: number) {}
  async settings({ response, actor }: RequestContext): Promise<void> {
    sendJson(response, 200, { settings: await this.service.readSettings(actor) });
  }
  async page({ response, actor, url }: RequestContext, collection: SyncCollection): Promise<void> {
    sendJson(response, 200, await this.service.readPage(actor, collection, url.searchParams));
  }
  async batch({ request, response, actor }: RequestContext): Promise<void> {
    await this.service.commit(actor, await readJson(request, this.bodyLimitBytes));
    sendJson(response, 200, { ok: true });
  }
}
