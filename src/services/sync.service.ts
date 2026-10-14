import { validateBatch, validatePage } from '../validators/sync.validator.js';
import type { SyncActor, SyncCollection, SyncRepository } from '../types/sync.js';

export class SyncService {
  constructor(private readonly repository: SyncRepository) {}
  readSettings(actor: SyncActor) { return this.repository.readSettings(actor.uid, actor.token); }
  readPage(actor: SyncActor, collection: SyncCollection, params: URLSearchParams) {
    const page = validatePage(collection, params);
    return this.repository.readPage(actor.uid, actor.token, page.collection, page.since, page.cursor);
  }
  async commit(actor: SyncActor, body: unknown): Promise<void> {
    const writes = validateBatch(body);
    await this.repository.commit(actor.uid, actor.token, writes);
  }
}
