import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncActor } from './sync.js';

export type TokenVerifier = (token: string) => Promise<{ uid: string }>;
export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  actor: SyncActor;
  url: URL;
  requestId: string;
}
export type Logger = (entry: Readonly<Record<string, unknown>>) => void;
