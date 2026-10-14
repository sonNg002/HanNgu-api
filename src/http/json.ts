import { ApiError } from '../errors/api-error.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export async function readJson(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  const contentType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ApiError(415, 'Cần Content-Type application/json.', 'UNSUPPORTED_MEDIA_TYPE');
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'Body nén không được hỗ trợ.', 'UNSUPPORTED_ENCODING');
  if (Number(request.headers['content-length']) > limitBytes) throw new ApiError(413, 'Payload vượt giới hạn.', 'PAYLOAD_TOO_LARGE');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
    };
    const fail = (error: ApiError) => { cleanup(); reject(error); };
    const onAborted = () => fail(new ApiError(400, 'Request bị ngắt.', 'REQUEST_ABORTED'));
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        chunks.length = 0;
        fail(new ApiError(413, 'Payload vượt giới hạn.', 'PAYLOAD_TOO_LARGE', { headers: { Connection: 'close' } }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'Body phải là JSON hợp lệ.', 'INVALID_JSON')); }
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', () => fail(new ApiError(400, 'Request bị ngắt.', 'REQUEST_ABORTED')));
  });
}
