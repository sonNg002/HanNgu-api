import { ApiError } from '../errors/api-error.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function applyCors(request: IncomingMessage, response: ServerResponse, origins: readonly string[]): boolean {
  // Vary kể cả response không có Origin để proxy không trộn cache giữa các origin.
  response.setHeader('Vary', 'Origin');
  const origin = request.headers.origin;
  if (origin) {
    if (!origins.includes(origin)) throw new ApiError(403, 'Origin không được cho phép.', 'ORIGIN_FORBIDDEN');
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After');
  }
  if (request.method !== 'OPTIONS') return false;
  const method = request.headers['access-control-request-method'];
  if (method && !['GET', 'POST'].includes(method)) throw new ApiError(405, 'Method không được cho phép.', 'METHOD_NOT_ALLOWED');
  const headers = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  if (headers.some(header => !['authorization', 'content-type'].includes(header))) throw new ApiError(403, 'Header không được cho phép.', 'HEADER_FORBIDDEN');
  response.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '600',
  });
  response.end();
  return true;
}
