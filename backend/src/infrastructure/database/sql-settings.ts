import { z } from 'zod';

const schema = z.object({
  SQL_DRIVER: z.enum(['windows', 'sql', 'entra']).default('windows'),
  SQL_SERVER: z.string().regex(/^[a-zA-Z0-9_.\\,-]+$/).default('localhost'),
  SQL_DATABASE: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/).default('jorge_motors_dev'),
  SQL_USER: z.string().min(1).optional(),
  SQL_PASSWORD: z.string().min(1).optional(),
  SQL_ENTRA_CLIENT_ID: z.uuid().optional(),
  SQL_TRUST_CERTIFICATE: z.enum(['true', 'false']).default('false'),
}).superRefine((settings, ctx) => {
  if (settings.SQL_DRIVER === 'sql' && (!settings.SQL_USER || !settings.SQL_PASSWORD)) {
    ctx.addIssue({ code: 'custom', message: 'SQL_USER y SQL_PASSWORD son obligatorios.' });
  }
  if (settings.SQL_DRIVER === 'entra') {
    if (!/^[a-zA-Z0-9-]+\.database\.windows\.net$/.test(settings.SQL_SERVER)) {
      ctx.addIssue({ code: 'custom', message: 'Entra exige el nombre DNS de Azure SQL.' });
    }
    if (settings.SQL_USER || settings.SQL_PASSWORD) {
      ctx.addIssue({ code: 'custom', message: 'Entra no acepta credenciales SQL.' });
    }
  } else if (settings.SQL_ENTRA_CLIENT_ID) {
    ctx.addIssue({ code: 'custom', message: 'SQL_ENTRA_CLIENT_ID solo aplica al driver Entra.' });
  }
  if (settings.SQL_TRUST_CERTIFICATE === 'true' && !['localhost', '.', '127.0.0.1'].includes(settings.SQL_SERVER)) {
    ctx.addIssue({ code: 'custom', message: 'Confiar en un certificado sin validar solo se permite en localhost.' });
  }
});

export type SqlSettings = z.infer<typeof schema>;
export function parseSqlSettings(environment: NodeJS.ProcessEnv): SqlSettings {
  const result = schema.safeParse(environment);
  if (!result.success) throw new Error('Configuración SQL inválida; revise SQL_DRIVER, servidor, base y autenticación.');
  return result.data;
}
