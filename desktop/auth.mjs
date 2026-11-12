import { PublicClientApplication } from '@azure/msal-node';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAuthConfig(config) {
  if (!config || !uuid.test(config.tenantId ?? '') || !uuid.test(config.desktopClientId ?? '') ||
    !uuid.test(config.apiClientId ?? '')) throw new Error('Identificadores Entra de escritorio incompletos.');
  const api = new URL(config.apiBaseUrl);
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash ||
    api.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error('La API de escritorio requiere HTTPS.');
  return { ...config, apiBaseUrl: api.href.replace(/\/$/, '') };
}

export class DesktopAuth {
  constructor(config, openBrowser, transport = fetch, grantStore = null, deviceIdentity = null) {
    this.config = validateAuthConfig(config);
    this.openBrowser = openBrowser;
    this.transport = transport;
    this.scopes = [`api://${config.apiClientId}/Inventario.Access`];
    this.client = new PublicClientApplication({ auth: {
      clientId: config.desktopClientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
    }, system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } });
    this.account = null;
    this.profile = null;
    this.grantStore = grantStore;
    this.deviceIdentity = deviceIdentity;
    this.offlineGrant = null;
  }

  async initialize() { this.offlineGrant = await this.grantStore?.load() ?? null; }
  state() { return { configured: true, signedIn: !!this.account, profile: this.profile,
    offlineAuthorized: !!this.offlineGrant,
    offlineProfile: this.offlineGrant
      ? { id: this.offlineGrant.id, nombres: this.offlineGrant.nombres, rol: this.offlineGrant.rol } : null,
    apiBaseUrl: this.config.apiBaseUrl }; }

  async signIn() {
    let result;
    try {
      result = await this.client.acquireTokenInteractive({ scopes: this.scopes, prompt: 'select_account',
        // MSAL Node genera el puerto loopback. Pasar redirectUri en esta API
        // provoca redirect_uri_not_supported sin broker nativo.
        openBrowser: this.openBrowser,
        successTemplate: '<h1>Acceso completado</h1><p>Puede cerrar esta pestaña y volver a Jorge Motors.</p>',
        errorTemplate: '<h1>No se completó el acceso</h1><p>Vuelva a Jorge Motors e inténtelo de nuevo.</p>' });
    } catch (error) {
      const aadsts = error instanceof Error ? error.message.match(/\bAADSTS\d{4,8}\b/)?.[0] : null;
      const msal = typeof error?.errorCode === 'string' && /^[a-z][a-z0-9_-]{1,63}$/i.test(error.errorCode)
        ? error.errorCode.toUpperCase().replaceAll('-', '_') : null;
      throw new Error(`JM_AUTH_ENTRA_${aadsts ?? msal ?? 'INTERACTIVE'}`);
    }
    if (!result?.account || !result.accessToken) throw new Error('JM_AUTH_ENTRA_NO_TOKEN');
    let response;
    try {
      response = await this.transport(this.config.apiBaseUrl + '/auth/me', {
        headers: { Authorization: `Bearer ${result.accessToken}` },
        signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error',
      });
    } catch { throw new Error('JM_AUTH_PROFILE_NETWORK'); }
    if (!response.ok) {
      let reason;
      if (response.status === 403) {
        await this.revokeOffline();
        try {
          const code = (await response.json())?.error?.code;
          if (['USER_NOT_REGISTERED', 'USER_DISABLED', 'ROLE_MISMATCH'].includes(code)) reason = code;
        } catch { /* La respuesta de error puede no tener JSON válido. */ }
      }
      const message = reason === 'USER_NOT_REGISTERED'
        ? 'La cuenta Microsoft elegida no tiene perfil en Jorge Motors. Seleccione la cuenta autorizada.'
        : reason === 'USER_DISABLED' ? 'El perfil de esta cuenta está inactivo.'
          : reason === 'ROLE_MISMATCH' ? 'El rol de Microsoft no coincide con el perfil habilitado.'
            : 'La API no autorizó este usuario y rol.';
      throw new Error(`${message} JM_AUTH_PROFILE_${reason ?? `HTTP_${response.status}`}`);
    }
    const body = await response.json();
    if (!body?.data || !['ADMINISTRADOR', 'MECANICO'].includes(body.data.rol) || !Number.isInteger(body.data.id))
      throw new Error('JM_AUTH_PROFILE_INVALID');
    const profile = { id: body.data.id, nombres: body.data.nombres, rol: body.data.rol };
    if (this.offlineGrant && (this.offlineGrant.id !== profile.id || this.offlineGrant.rol !== profile.rol)) {
      this.offlineGrant = null;
      await this.grantStore?.clear();
    }
    if (this.deviceIdentity) {
      const registration = { deviceId: this.deviceIdentity.deviceId, publicKey: this.deviceIdentity.publicKey };
      let registered;
      try {
        registered = await this.transport(this.config.apiBaseUrl + '/sync/devices', {
          method: 'POST', headers: { Authorization: `Bearer ${result.accessToken}`, 'Content-Type': 'application/json',
            ...this.deviceIdentity.proofHeaders('POST', '/api/v1/sync/devices', registration) },
          body: JSON.stringify(registration), signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error',
        });
      } catch { throw new Error('JM_AUTH_DEVICE_NETWORK'); }
      if (!registered.ok) {
        if ([401, 403].includes(registered.status)) { this.offlineGrant = null; await this.grantStore?.clear(); }
        throw new Error(`La API no registró la identidad de este equipo. JM_AUTH_DEVICE_HTTP_${registered.status}`);
      }
    }
    this.account = result.account;
    this.profile = profile;
    if (this.grantStore && this.deviceIdentity) {
      try {
        const grantRequest = { deviceId: this.grantStore.deviceId };
        const grantResponse = await this.transport(this.config.apiBaseUrl + '/auth/offline-grant', {
          method: 'POST', headers: { Authorization: `Bearer ${result.accessToken}`, 'Content-Type': 'application/json',
            ...this.deviceIdentity.proofHeaders('POST', '/api/v1/auth/offline-grant', grantRequest) },
          body: JSON.stringify(grantRequest), signal: AbortSignal.timeout(15_000),
          cache: 'no-store', redirect: 'error',
        });
        if (grantResponse.ok) {
          const grant = (await grantResponse.json())?.data?.grant;
          const verified = await this.grantStore.save(grant);
          if (verified.id !== this.profile.id || verified.rol !== this.profile.rol) {
            this.offlineGrant = null;
            await this.grantStore.clear();
            throw new Error('El permiso local no coincide con el perfil actual.');
          }
          this.offlineGrant = await this.grantStore.load();
        } else if ([401, 403].includes(grantResponse.status)) {
          this.offlineGrant = null; await this.grantStore.clear();
        }
      } catch { /* El permiso previo del mismo usuario sigue disponible si falla la red. */ }
    }
    return this.state();
  }

  async token() {
    if (!this.account) throw new Error('Debe iniciar sesión en línea.');
    const result = await this.client.acquireTokenSilent({ scopes: this.scopes, account: this.account });
    if (!result?.accessToken) throw new Error('No se pudo renovar la sesión.');
    return result.accessToken;
  }

  async revokeOffline() {
    this.offlineGrant = null;
    await this.grantStore?.clear();
  }

  async signOut() {
    if (this.account) await this.client.getTokenCache().removeAccount(this.account);
    this.account = null;
    this.profile = null;
    await this.revokeOffline();
    return this.state();
  }
}
