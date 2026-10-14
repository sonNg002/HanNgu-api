import { pathToFileURL } from 'node:url';
import { createApiServer } from './app.js';
import { readConfig } from './config/env.js';
import type { AppConfig } from './config/env.js';
import type { Logger } from './types/http.js';

export { createApiServer, readConfig };

export function startServer({ config = readConfig(), logger = entry => console.log(JSON.stringify(entry)) }: { config?: AppConfig; logger?: Logger } = {}) {
  const server = createApiServer({ config, logger });
  server.listen(config.port, config.host, () => logger({ event: 'server.started', host: config.host, port: config.port, environment: config.environment }));
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger({ event: 'server.stopping', signal });
    const timer = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, config.shutdownTimeoutMs);
    timer.unref();
    server.close(() => { clearTimeout(timer); process.exit(0); });
    server.closeIdleConnections();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => shutdown(signal));
  server.once('error', error => {
    logger({ event: 'server.error', code: 'code' in error ? error.code : 'UNKNOWN' });
    process.exitCode = 1;
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startServer(); }
  catch (error) { console.error(JSON.stringify({ event: 'server.config_error', message: error instanceof Error ? error.message : 'Unknown error' })); process.exitCode = 1; }
}
