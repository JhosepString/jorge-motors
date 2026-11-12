import { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startStaticServer } from './static-server.mjs';
import { DesktopAuth } from './auth.mjs';
import { ProtectedGrantStore } from './offline-grant.mjs';
import { ProtectedDeviceIdentity } from './device-identity.mjs';
import { proxyApiRequest } from './api-proxy.mjs';
import { reviewUninstall } from './uninstall-review.mjs';
import { LocalInventoryStore, LocalBootstrapClient, LocalSyncClient } from './local-runtime.mjs';

let window;
let staticServer;
let local;
app.setName('Jorge Motors');
app.setAppUserModelId('pe.jorgemotors.inventory');
app.setPath('userData', join(app.getPath('appData'), 'Jorge Motors'));
app.on('window-all-closed', () => app.quit());
if (process.argv.includes('--uninstall-review')) {
  app.whenReady().then(async () => app.exit(await reviewUninstall(app.getPath('userData'), dialog)))
    .catch(() => app.exit(1));
} else app.whenReady().then(async () => {
  let auth;
  let sync;
  let bootstrap;
  let updateRunning = false;
  try {
    const config = JSON.parse(await readFile(join(app.getAppPath(), 'auth-config.json'), 'utf8'));
    const dataDir = app.getPath('userData');
    await mkdir(dataDir, { recursive: true });
    const idPath = join(dataDir, 'device-id');
    let deviceId;
    try { deviceId = (await readFile(idPath, 'utf8')).trim(); }
    catch { deviceId = randomUUID(); await writeFile(idPath, deviceId, { flag: 'wx' }); }
    const deviceIdentity = new ProtectedDeviceIdentity(join(dataDir, 'device-identity.bin'), safeStorage, deviceId);
    await deviceIdentity.initialize();
    const grantStore = config.offlineGrantPublicKeyPem
      ? new ProtectedGrantStore(join(dataDir, 'offline-grant.bin'), safeStorage, config.offlineGrantPublicKeyPem, deviceId)
      : null;
    auth = new DesktopAuth(config, (url) => shell.openExternal(url), fetch, grantStore, deviceIdentity);
    await auth.initialize();
    local = new LocalInventoryStore(join(dataDir, 'inventory.sqlite'), deviceId);
    const proof = (method, path, body) => deviceIdentity.proofHeaders(method, path, body);
    sync = new LocalSyncClient(local, config.apiBaseUrl, () => auth.token(), fetch, proof);
    bootstrap = new LocalBootstrapClient(local, config.apiBaseUrl, () => auth.token(), fetch, proof);
  } catch (error) { console.error('Desktop auth configuration unavailable:', error.message); }
  const { server, origin } = await startStaticServer(join(app.getAppPath(), 'frontend'));
  staticServer = server;
  const updateLocal = async (userId) => {
    if (updateRunning || !sync || !bootstrap) throw new Error('Local update is already running or unavailable.');
    updateRunning = true;
    try {
      const result = await sync.runOnce(userId);
      if (result.revoked) { await auth.revokeOffline(); return result; }
      if (!result.stopped) await bootstrap.refresh(userId);
      return result;
    } catch (error) {
      if (error?.code === 'DEVICE_NOT_REGISTERED') await auth.revokeOffline();
      throw error;
    } finally { updateRunning = false; }
  };
  const fromWindow = (event) => event.sender === window?.webContents && event.senderFrame === window?.webContents.mainFrame;
  ipcMain.handle('auth:state', (event) => {
    if (!fromWindow(event)) throw new Error('Unauthorized window');
    return auth?.state() ?? { configured: false, signedIn: false, profile: null, apiBaseUrl: null };
  });
  ipcMain.handle('auth:sign-in', async (event) => {
    if (!fromWindow(event) || !auth) throw new Error('Desktop identity is not configured.');
    const state = await auth.signIn();
    try { await bootstrap?.download(state.profile.id); }
    catch (error) {
      if (error?.code === 'DEVICE_NOT_REGISTERED') await auth.revokeOffline();
      console.error('Initial local download is pending.');
    }
    if (local?.bootstrapCursor(state.profile.id) === null) void updateLocal(state.profile.id).catch(() => undefined);
    return state;
  });
  ipcMain.handle('api:request', async (event, input) => {
    if (!fromWindow(event) || !auth?.state().signedIn) throw new Error('Online session required.');
    return proxyApiRequest(auth.config.apiBaseUrl, () => auth.token(), input);
  });
  ipcMain.handle('auth:sign-out', (event) => {
    if (!fromWindow(event) || !auth) throw new Error('Desktop identity is not configured.');
    return auth.signOut();
  });
  const localActor = () => {
    const state = auth?.state();
    if (!state?.offlineAuthorized || !state.offlineProfile || !local ||
      local.bootstrapCursor(state.offlineProfile.id) !== null) throw new Error('Local access is not ready.');
    return state.offlineProfile;
  };
  ipcMain.handle('local:status', (event) => {
    if (!fromWindow(event)) throw new Error('Unauthorized window');
    const state = auth?.state();
    const actor = state?.offlineAuthorized ? state.offlineProfile : null;
    return { ready: !!actor && !!local && local.bootstrapCursor(actor.id) === null,
      profile: actor, online: !!state?.signedIn,
      pending: actor && local ? local.pendingCount(actor.id) : 0 };
  });
  ipcMain.handle('local:inventory', (event) => {
    if (!fromWindow(event)) throw new Error('Unauthorized window');
    localActor();
    return local.db.prepare(`SELECT id,sku,name,confirmed_stock AS confirmedStock,
      offline_quota AS offlineQuota,stock_minimum AS stockMinimum FROM product WHERE active=1 ORDER BY name,id`).all();
  });
  ipcMain.handle('local:operations', (event) => {
    if (!fromWindow(event)) throw new Error('Unauthorized window');
    const actor = localActor();
    return local.db.prepare(`SELECT o.operation_id AS operationId,o.status,o.error,m.type,m.quantity,
      m.reason,m.created_at AS createdAt,p.sku,p.name
      FROM sync_operation o JOIN local_movement m ON m.id=o.operation_id
      JOIN product p ON p.id=m.product_id WHERE o.user_id=? AND o.status IN ('PENDING','REJECTED')
      ORDER BY m.created_at DESC LIMIT 100`).all(actor.id);
  });
  ipcMain.handle('local:move', (event, input) => {
    if (!fromWindow(event)) throw new Error('Unauthorized window');
    const actor = localActor();
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !['productId','type','quantity','reason','reference'].includes(key)))
      throw new Error('Invalid local movement.');
    if (input.type === 'ENTRADA' && actor.rol !== 'ADMINISTRADOR')
      throw new Error('Current role does not permit local entries.');
    return local.registerMovement({ ...input, userId: actor.id, idempotencyKey: randomUUID() });
  });
  ipcMain.handle('local:sync', async (event) => {
    if (!fromWindow(event) || !auth?.state().signedIn || !sync) throw new Error('Online session required.');
    const actor = localActor();
    return updateLocal(actor.id);
  });
  const syncTimer = setInterval(() => {
    const state = auth?.state();
    if (state?.signedIn && state.offlineAuthorized && state.offlineProfile &&
      local?.bootstrapCursor(state.offlineProfile.id) === null)
      void updateLocal(state.offlineProfile.id).catch(() => undefined);
  }, 60_000);
  syncTimer.unref();
  window = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 650,
    title: 'Jorge Motors', icon: join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, preload: join(app.getAppPath(), 'preload.cjs') } });
  if (app.isPackaged) window.setAppDetails({ appId: 'pe.jorgemotors.inventory',
    appIconPath: process.execPath, appIconIndex: 0, relaunchCommand: process.execPath });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.protocol === 'https:' && target.hostname === 'login.microsoftonline.com') void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin + '/')) event.preventDefault();
  });
  await window.loadURL(origin);
}).catch((error) => { console.error(error); app.quit(); });
app.on('before-quit', () => { staticServer?.close(); try { local?.close(); } catch {} });
