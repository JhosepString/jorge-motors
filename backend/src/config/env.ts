import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  }, 'Debe ser un origen HTTP(S), sin ruta ni credenciales.')
    .transform((value) => new URL(value).origin)
    .default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

// Función pura: importar app.ts no lee secretos ni inicia un servidor.
export function parseEnvironment(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Configuración inválida: ${fields.join(', ')}`);
  }
  return result.data;
}
