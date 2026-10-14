import { ApiError } from '../errors/api-error.js';

export function createRateLimiter({ maxRequests, windowMs, now = Date.now, maxKeys = 10000 }: {
  maxRequests: number; windowMs: number; now?: () => number; maxKeys?: number;
}): (key: string) => void {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      if (!bucket && buckets.size >= maxKeys) {
        for (const [entry, value] of buckets) if (value.resetAt <= time) buckets.delete(entry);
        if (buckets.size >= maxKeys) throw new ApiError(503, 'Server đang bận. Hãy thử lại.', 'RATE_LIMIT_CAPACITY', { headers: { 'Retry-After': '60' } });
      }
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > maxRequests) {
      throw new ApiError(429, 'Quá nhiều yêu cầu. Hãy thử lại sau.', 'RATE_LIMITED', {
        headers: { 'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - time) / 1000))) },
      });
    }
  };
}
