import type sql from 'mssql';
import type { SqlSettings } from './sql-settings.js';

export type SqlDriver = typeof sql;
export interface SqlConnection { driver: SqlDriver; pool: sql.ConnectionPool }
type Connector = (settings: SqlSettings) => Promise<SqlConnection>;

export function sqlPoolLimit(driver: 'windows' | 'sql', configuredWorkers?: string): number {
  if (driver !== 'windows') return 5;
  const workers = configuredWorkers && /^[1-9][0-9]{0,3}$/.test(configuredWorkers) ? Number(configuredWorkers) : 4;
  // ODBC usa trabajadores nativos: dejar margen para que el dueño de un lock
  // continúe/commit y para E/S local, en vez de ocupar todos esperando SQL.
  return Math.max(1, Math.min(3, workers - 1));
}

export async function connectSql(settings: SqlSettings): Promise<SqlConnection> {
  // El driver nativo solo se carga para Windows local. En Linux se usa Tedious.
  const driverModule = settings.SQL_DRIVER === 'windows' ? 'mssql/msnodesqlv8.js' : 'mssql';
  const driver = (await import(driverModule)).default as SqlDriver;
  const config: sql.config & { connectionString?: string } = {
    server: settings.SQL_SERVER,
    database: settings.SQL_DATABASE,
    pool: { min: 0, max: sqlPoolLimit(settings.SQL_DRIVER, process.env.UV_THREADPOOL_SIZE), idleTimeoutMillis: 10_000 },
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    options: { encrypt: true, trustServerCertificate: settings.SQL_TRUST_CERTIFICATE === 'true' },
  };
  if (settings.SQL_DRIVER === 'windows') {
    // Shared memory permite usar la instancia local sin habilitar TCP ni abrir puertos.
    const server = ['localhost', '.', '127.0.0.1'].includes(settings.SQL_SERVER)
      ? 'lpc:localhost' : settings.SQL_SERVER;
    config.connectionString = `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${settings.SQL_DATABASE};Trusted_Connection=Yes;Encrypt=Yes;TrustServerCertificate=${settings.SQL_TRUST_CERTIFICATE === 'true' ? 'Yes' : 'No'};`;
    Object.assign(config.options!, { trustedConnection: true });
  } else {
    config.user = settings.SQL_USER!;
    config.password = settings.SQL_PASSWORD!;
  }
  const pool = new driver.ConnectionPool(config);
  // El evento error debe estar atendido para evitar errores no controlados del pool.
  pool.on('error', () => { console.error(JSON.stringify({ level: 'error', event: 'sql_pool_error' })); });
  try {
    await pool.connect();
    return { driver, pool };
  } catch (error) {
    await pool.close().catch(() => undefined);
    throw error;
  }
}

// Singleton: el constructor privado y el acceso estático controlan la instancia.
// La promesa compartida evita dos pools si coinciden llamadas de arranque.
export class SqlPoolSingleton {
  private static readonly instance = new SqlPoolSingleton();
  private connection: Promise<SqlConnection> | undefined;
  private settingsKey: string | undefined;
  private constructor() {}

  static getInstance(): SqlPoolSingleton { return this.instance; }

  getConnection(settings: SqlSettings, connector: Connector = connectSql): Promise<SqlConnection> {
    const key = JSON.stringify(settings);
    if (this.connection && this.settingsKey !== key) {
      throw new Error('El pool del proceso ya está asociado a otra configuración.');
    }
    if (!this.connection) {
      this.settingsKey = key;
      this.connection = connector(settings).catch((error: unknown) => {
        this.connection = undefined;
        this.settingsKey = undefined;
        throw error;
      });
    }
    return this.connection;
  }

  async close(): Promise<void> {
    const pending = this.connection;
    if (!pending) return;
    try { await (await pending).pool.close(); }
    finally { this.connection = undefined; this.settingsKey = undefined; }
  }
}
