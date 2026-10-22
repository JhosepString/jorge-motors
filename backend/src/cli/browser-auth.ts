import { randomUUID } from 'node:crypto';
import type { PublicClientApplication } from '@azure/msal-node';

// MSAL administra PKCE S256 y el receptor temporal enlazado a 127.0.0.1.
// No se crea un servidor accesible desde la red ni se persiste la caché.
export async function acquireBrowserToken(
  client: Pick<PublicClientApplication, 'acquireTokenInteractive'>,
  audience: string,
  openBrowser: (url: string) => Promise<void>,
) {
  return client.acquireTokenInteractive({
    scopes: [`api://${audience}/Inventario.Access`],
    prompt: 'select_account',
    nonce: randomUUID(),
    openBrowser: async (address) => {
      const url = new URL(address);
      if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com'
        || url.username || url.password) {
        throw new Error('Destino de autenticación no permitido.');
      }
      await openBrowser(address);
    },
    successTemplate: '<!doctype html><meta charset="utf-8"><title>Jorge Motors</title><p>Respuesta de Microsoft recibida. Vuelve a la terminal para comprobar el acceso a Jorge Motors. Puedes cerrar esta pestaña.</p>',
    errorTemplate: '<!doctype html><meta charset="utf-8"><title>Jorge Motors</title><p>No se completó el inicio de sesión. Vuelve a la terminal. No compartas contraseñas ni códigos.</p>',
  });
}
