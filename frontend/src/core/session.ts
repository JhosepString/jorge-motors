import { SessionRequired } from './api';
export interface Session {
  configured: boolean;
  hasAccount(): boolean;
  token(): Promise<string>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createSession(env: Record<string, string | undefined>): Promise<Session> {
  const tenant = env.VITE_ENTRA_TENANT_ID;
  const clientId = env.VITE_ENTRA_SPA_CLIENT_ID;
  const apiId = env.VITE_ENTRA_API_CLIENT_ID;
  if (![tenant, clientId, apiId].every((v) => v && uuid.test(v)))
    return {
      configured: false,
      hasAccount: () => false,
      token: async () => {
        throw new SessionRequired();
      },
      signIn: async () => {
        throw new Error('Complete la configuración SPA.');
      },
      signOut: async () => {},
    };
  const redirectUri = env.VITE_REDIRECT_URI ?? `${window.location.origin}/redirect.html`;
  if (redirectUri !== `${window.location.origin}/redirect.html`)
    throw new Error('El retorno SPA debe coincidir con el origen local/publicado y usar /redirect.html.');
  const { PublicClientApplication, InteractionRequiredAuthError, BrowserCacheLocation } =
    await import('@azure/msal-browser');
  const client = new PublicClientApplication({
    auth: {
      clientId: clientId!,
      authority: `https://login.microsoftonline.com/${tenant}`,
      redirectUri,
      postLogoutRedirectUri: `${window.location.origin}/`,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
  });
  await client.initialize();
  const result = await client.handleRedirectPromise();
  const account = result?.account ?? client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (account) client.setActiveAccount(account);
  const scopes = [`api://${apiId}/Inventario.Access`];
  return {
    configured: true,
    hasAccount: () => !!client.getActiveAccount(),
    async token() {
      const selected = client.getActiveAccount();
      if (!selected) throw new SessionRequired();
      try {
        return (await client.acquireTokenSilent({ scopes, account: selected })).accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) throw new SessionRequired();
        throw error;
      }
    },
    async signIn() {
      await client.loginRedirect({ scopes, prompt: 'select_account' });
    },
    async signOut() {
      await client.logoutRedirect({ account: client.getActiveAccount() });
    },
  };
}
