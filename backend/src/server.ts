import { createApp } from './app.js';
import { parseEnvironment } from './config/env.js';
import { consoleLogger } from './shared/logger.js';
import { runtimeServices } from './infrastructure/runtime-services.js';
import { SqlPoolSingleton } from './infrastructure/database/sql-pool.js';

const config = parseEnvironment(process.env);
const server = createApp(config, consoleLogger, runtimeServices(process.env)).listen(config.PORT, config.HOST, () => {
  consoleLogger.info({ event: 'server_started', host: config.HOST, port: config.PORT });
});

server.on('error', () => {
  consoleLogger.error({ event: 'server_start_failed' });
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  consoleLogger.info({ event: 'server_stopping', signal });
  const deadline = setTimeout(() => {
    consoleLogger.error({ event: 'shutdown_timeout' });
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close((error) => {
    void SqlPoolSingleton.getInstance().close().then(() => {
      process.exitCode = error ? 1 : 0;
    }).catch(() => { process.exitCode = 1; }).finally(() => { clearTimeout(deadline); });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
