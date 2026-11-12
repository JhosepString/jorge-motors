import type { LocalInventoryStore } from './local-inventory.js';

export interface SyncRun { confirmed: number; rejected: number; remaining: number; stopped: boolean; revoked?: boolean }

// Sends one durable operation at a time. A failed/ambiguous response stays pending
// and is retried with the same operation ID, never re-created locally.
export class LocalSyncClient {
  private running = false;

  constructor(private readonly store: LocalInventoryStore, private readonly apiBaseUrl: string,
    private readonly token: () => Promise<string>, private readonly transport: typeof fetch = fetch,
    private readonly proofHeaders: (method: string, path: string, body?: unknown) => Record<string, string> = () => ({})) {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error('Sync API requires HTTPS /api/v1.');
    this.apiBaseUrl = url.href.replace(/\/$/, '');
  }

  async runOnce(userId: number): Promise<SyncRun> {
    if (this.running) throw new Error('Synchronization is already running.');
    this.running = true;
    const result: SyncRun = { confirmed: 0, rejected: 0, remaining: 0, stopped: false };
    try {
      for (const operation of this.store.pendingOperations(userId)) {
        try {
          const bearer = await this.token();
          if (!bearer) throw new Error('Missing access token.');
          const body = { operationId: operation.operationId, deviceId: operation.deviceId,
            kind: operation.kind, payload: JSON.parse(operation.payload) };
          const response = await this.transport(`${this.apiBaseUrl}/sync/operations`, {
            method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json',
              ...this.proofHeaders('POST', '/api/v1/sync/operations', body) },
            body: JSON.stringify(body),
            cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            if (response.status === 403 && (await response.json().catch(() => ({})))?.error?.code === 'DEVICE_NOT_REGISTERED')
              result.revoked = true;
            result.stopped = true; break;
          }
          const receipt = (await response.json())?.data;
          if (receipt?.operationId !== operation.operationId) throw new Error('Receipt ID mismatch.');
          if (receipt.status === 'CONFIRMED') {
            this.store.confirmOperation(operation.operationId, receipt.remoteId);
            result.confirmed++;
          } else if (receipt.status === 'REJECTED' && typeof receipt.code === 'string') {
            this.store.rejectOperation(operation.operationId, receipt.code);
            result.rejected++;
          } else throw new Error('Invalid sync receipt.');
        } catch { result.stopped = true; break; }
      }
      result.remaining = this.store.pendingOperations(userId).length;
      return result;
    } finally { this.running = false; }
  }
}
