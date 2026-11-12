import type { LocalInventoryStore } from './local-inventory.js';

export class LocalBootstrapClient {
  private running = false;
  constructor(private readonly store: LocalInventoryStore, private readonly apiBaseUrl: string,
    private readonly token: () => Promise<string>, private readonly transport: typeof fetch = fetch,
    private readonly proofHeaders: (method: string, path: string, body?: unknown) => Record<string, string> = () => ({})) {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error('Bootstrap API requires HTTPS /api/v1.');
    this.apiBaseUrl = url.href.replace(/\/$/, '');
  }

  async download(userId: number): Promise<number> {
    return this.fetchPages(userId, false);
  }

  async refresh(userId: number): Promise<number> {
    if (this.running) throw new Error('Download already running.');
    this.store.beginRefresh(userId);
    return this.fetchPages(userId, true);
  }

  private async fetchPages(userId: number, refresh: boolean): Promise<number> {
    if (this.running) throw new Error('Download already running.');
    this.running = true;
    let count = 0;
    try { for (let page = 0; page < 1000; page++) {
      const after = refresh ? this.store.refreshCursor(userId) : this.store.bootstrapCursor(userId);
      if (after === null) return count;
      const bearer = await this.token();
      if (!bearer) throw new Error('Online session required for first download.');
      const query = new URLSearchParams({ deviceId: this.store.deviceId, after: String(after), limit: '100' });
      const path = `/api/v1/sync/bootstrap?${query}`;
      const response = await this.transport(`${this.apiBaseUrl}/sync/bootstrap?${query}`, {
        headers: { Authorization: `Bearer ${bearer}`, ...this.proofHeaders('GET', path) }, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new Error(`Bootstrap rejected (${response.status}).`) as Error & { code?: string };
        if (response.status === 403 && (await response.json().catch(() => ({})))?.error?.code === 'DEVICE_NOT_REGISTERED')
          error.code = 'DEVICE_NOT_REGISTERED';
        throw error;
      }
      const data = (await response.json())?.data;
      if (refresh) this.store.applyRefreshPage(data, userId, after);
      else this.store.applyBootstrapPage(data, userId, after);
      count += data.products.length;
    }
    throw new Error('Bootstrap exceeds page limit.');
    } finally { this.running = false; }
  }
}
