export function desktopTransport(apiBaseUrl: string, bridge: NonNullable<Window['jorgeDesktop']>): typeof fetch {
  const base = apiBaseUrl.replace(/\/$/, '');
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== 'string' || !input.startsWith(base + '/')) throw new Error('Destino de API inválido.');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init?.headers)) {
      if (['content-type', 'idempotency-key', 'if-match'].includes(name)) headers[name] = value;
    }
    let body: string | Uint8Array | undefined;
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof Blob) body = new Uint8Array(await init.body.arrayBuffer());
    else if (init?.body !== undefined && init.body !== null) throw new Error('Cuerpo de solicitud incompatible.');
    const result = await bridge.apiRequest({ path: input.slice(base.length), method, headers,
      ...(body === undefined ? {} : { body }) });
    return new Response([204, 205, 304].includes(result.status) ? null : new Uint8Array(result.body).buffer,
      { status: result.status, headers: result.headers });
  };
}
