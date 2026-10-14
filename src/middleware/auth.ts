import { ApiError } from '../errors/api-error.js';
import type { IncomingMessage } from 'node:http';
import type { TokenVerifier } from '../types/http.js';
import type { SyncActor } from '../types/sync.js';

export async function authenticate(request: IncomingMessage, verifyToken: TokenVerifier): Promise<SyncActor> {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '');
  if (!match || match[1].length > 16384) throw new ApiError(401, 'Cần đăng nhập.', 'UNAUTHENTICATED');
  let user: { uid: string };
  try { user = await verifyToken(match[1]); }
  catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (typeof code === 'string' && ['auth/internal-error', 'app/network-error'].includes(code)) {
      throw new ApiError(503, 'Dịch vụ xác thực chưa sẵn sàng. Hãy thử lại.', 'AUTH_UNAVAILABLE');
    }
    throw new ApiError(401, 'Token đăng nhập không hợp lệ.', 'UNAUTHENTICATED');
  }
  if (typeof user?.uid !== 'string' || !user.uid || user.uid.includes('/') || Buffer.byteLength(user.uid) > 128) {
    throw new ApiError(401, 'Token thiếu UID hợp lệ.', 'UNAUTHENTICATED');
  }
  return Object.freeze({ uid: user.uid, token: match[1] });
}
