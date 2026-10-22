export interface Logger {
  info(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
}

// Inyección por parámetro: las pruebas pueden observar los registros sin stdout.
export const consoleLogger: Logger = {
  info: (entry) => console.info(JSON.stringify({ level: 'info', ...entry })),
  error: (entry) => console.error(JSON.stringify({ level: 'error', ...entry })),
};
