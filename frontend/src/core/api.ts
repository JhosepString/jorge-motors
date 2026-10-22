export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}
export class SessionRequired extends Error {}
export function apiBase(value: string) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, '') !== '/api/v1'
  ) {
    throw new Error('URL de API inválida.');
  }
  return url.href.replace(/\/$/, '');
}
export class ApiClient {
  private readonly base: string;
  constructor(
    base: string,
    private readonly token: () => Promise<string>,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.base = apiBase(base);
  }
  async response(path: string, init: RequestInit = {}) {
    if (!/^\/[a-z0-9/-]+(?:\?[^#]*)?$/i.test(path) || path.includes('..'))
      throw new Error('Ruta de API inválida.');
    const bearer = await this.token();
    if (!bearer) throw new SessionRequired();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${bearer}`);
    if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    let result: Response;
    const transport = this.transport; // fetch del navegador no admite el cliente como receptor `this`.
    try {
      result = await transport(this.base + path, {
        ...init,
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'No se pudo confirmar la respuesta. Compruebe la conexión y reintente la misma operación.',
      );
    }
    if (!result.ok) {
      const body = (await result.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      throw new ApiError(
        result.status,
        body.error?.code ?? 'API_ERROR',
        body.error?.message ?? 'No se completó la operación.',
        body.error?.requestId,
      );
    }
    return result;
  }
  async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.response(path, init)).json() as Promise<T>;
  }
}
export function errorText(error: unknown) {
  if (error instanceof SessionRequired || (error instanceof ApiError && error.status === 401))
    return 'La sesión necesita renovarse. Cierre sesión y vuelva a ingresar con Microsoft.';
  if (error instanceof ApiError)
    return `${error.message}${error.requestId ? ` Código de seguimiento: ${error.requestId}` : ''}`;
  return 'No se completó la operación. Intente nuevamente.';
}
export function pen(value: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) return 'Importe no disponible';
  const [whole, cents] = value.split('.');
  return `S/ ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
export function stockStatus(item: { activo?: boolean; stockActual: number; stockMinimo: number }) {
  return item.activo === false
    ? 'INACTIVO'
    : item.stockActual === 0
      ? 'AGOTADO'
      : item.stockActual <= item.stockMinimo
        ? 'BAJO_MINIMO'
        : 'NORMAL';
}
// Una clave por intención, no por intento HTTP. El componente la conserva tras errores de red.
export class MovementIntent {
  private payload = '';
  private key = '';
  forPayload(body: unknown) {
    const text = JSON.stringify(body);
    if (text !== this.payload) {
      this.payload = text;
      this.key = crypto.randomUUID();
    }
    return this.key;
  }
  reset() {
    this.payload = '';
    this.key = '';
  }
}
