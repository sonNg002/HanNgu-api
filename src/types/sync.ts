export type SyncCollection = 'cards' | 'reviews';
export type CardType = 'recognize' | 'write' | 'recall-hv';

export interface SyncMetadata {
  id: string;
  updatedAt: number;
  revision: string;
}
export interface RemoteSettings extends SyncMetadata {
  id: 'main';
  newPerDay: number;
  order: 'hsk' | 'freq';
}
export interface RemoteCard extends SyncMetadata {
  type: CardType;
  targetId: string;
  mnemonic: string;
  introducedAt: number;
  fsrs: Record<string, number> & { due: number; reps: number };
}
export interface RemoteReview extends SyncMetadata {
  type: CardType;
  targetId: string;
  cardId: string;
  rating: number;
  reviewedAt: number;
  durationMs: number;
  fsrsLog: Record<string, number> & { due: number; review: number };
  writing?: { strokeCount: number; totalMistakes: number; usedHint: boolean };
}
export type SyncWrite =
  | { collection: 'settings'; id: string; data: RemoteSettings }
  | { collection: 'cards'; id: string; data: RemoteCard }
  | { collection: 'reviews'; id: string; data: RemoteReview };
export interface PageCursor { id: string; timestamp: string }
export interface RemotePage {
  documents: { id: string; data: RemoteCard | RemoteReview; serverUpdatedAt: number }[];
  next?: PageCursor;
}
export interface SyncActor { readonly uid: string; readonly token: string }
export interface SyncRepository {
  readSettings(uid: string, token: string): Promise<RemoteSettings | null>;
  readPage(uid: string, token: string, collection: SyncCollection, since: number, cursor?: PageCursor): Promise<RemotePage>;
  commit(uid: string, token: string, writes: SyncWrite[]): Promise<void>;
}
