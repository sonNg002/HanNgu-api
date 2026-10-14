type Environment = Readonly<Record<string, string | undefined>>;
function integer(env: Environment, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum || Number(raw) > maximum) {
    throw new Error(`${key} phải là số nguyên từ ${minimum} đến ${maximum}.`);
  }
  return Number(raw);
}

export function readConfig(env: Environment = process.env) {
  const environment = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(environment)) throw new Error('NODE_ENV không hợp lệ.');
  const project = env.FIREBASE_PROJECT_ID || 'hanngu-91a22';
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw new Error('FIREBASE_PROJECT_ID không hợp lệ.');
  const authEmulator = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = env.FIRESTORE_EMULATOR_HOST;
  if (!!authEmulator !== !!firestoreEmulator || ((authEmulator || firestoreEmulator) && (!project.startsWith('demo-') || environment === 'production'))) {
    throw new Error('Emulator cần cả hai host, project demo- và môi trường development/test.');
  }
  for (const host of [authEmulator, firestoreEmulator].filter((value): value is string => Boolean(value))) {
    if (!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d+$/.test(host)) throw new Error('Host emulator không hợp lệ.');
  }
  const host = env.HOST || (environment === 'production' ? '0.0.0.0' : '127.0.0.1');
  if (!host.trim() || /[\s/]/.test(host)) throw new Error('HOST không hợp lệ.');
  if (environment === 'production' && !env.CORS_ORIGINS?.trim()) throw new Error('Production cần CORS_ORIGINS.');
  const origins = [...new Set((env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(value => value.trim()).filter(Boolean))];
  for (const origin of origins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS phải chứa origin HTTP/HTTPS.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error('CORS_ORIGINS phải chứa origin chính xác, không có path hoặc wildcard.');
    if (environment === 'production' && url.protocol !== 'https:') throw new Error('Origin production phải dùng HTTPS.');
  }
  return Object.freeze({
    environment, project, host, firestoreEmulator, origins: Object.freeze(origins),
    port: integer(env, 'PORT', 8080, 1, 65535),
    bodyLimitBytes: integer(env, 'BODY_LIMIT_BYTES', 8 * 1024 * 1024, 1024, 8 * 1024 * 1024),
    upstreamTimeoutMs: integer(env, 'UPSTREAM_TIMEOUT_MS', 20000, 100, 25000),
    shutdownTimeoutMs: integer(env, 'SHUTDOWN_TIMEOUT_MS', 10000, 100, 60000),
    rateLimitMax: integer(env, 'RATE_LIMIT_MAX', 120, 1, 100000),
    rateLimitWindowMs: integer(env, 'RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
  });
}

export type AppConfig = ReturnType<typeof readConfig>;
