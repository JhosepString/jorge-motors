const route = /^\/[a-z0-9/-]+(?:\?[^#]*)?$/i;
const allowedHeaders = new Set(['content-type', 'idempotency-key', 'if-match']);
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const maxUpload = 5 * 1024 * 1024;
const maxResponse = 12 * 1024 * 1024;

export function validateApiRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !route.test(input.path ?? '') || input.path.startsWith('//') || input.path.includes('..') || input.path.length > 2048 ||
    !methods.has(input.method)) throw new Error('Invalid API request.');
  const headers = input.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) ||
    Object.entries(headers).some(([key, value]) => !allowedHeaders.has(key.toLowerCase()) ||
      typeof value !== 'string' || value.length > 512 || /[\r\n]/.test(value)))
    throw new Error('Invalid API headers.');
  const body = input.body;
  if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array))
    throw new Error('Invalid API body.');
  const bytes = typeof body === 'string' ? Buffer.byteLength(body) : body?.byteLength ?? 0;
  if (bytes > maxUpload || (typeof body === 'string' && bytes > 64 * 1024) ||
    (input.method === 'GET' && body !== undefined)) throw new Error('API body exceeds limit.');
  return { path: input.path, method: input.method, headers, body };
}

async function limitedBytes(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxResponse) throw new Error('API response exceeds limit.');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponse) throw new Error('API response exceeds limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function proxyApiRequest(apiBaseUrl, token, input, transport = fetch) {
  const request = validateApiRequest(input);
  const base = new URL(apiBaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
    base.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error('Invalid API configuration.');
  const bearer = await token();
  if (!bearer) throw new Error('Online session required.');
  const response = await transport(base.href.replace(/\/$/, '') + request.path, {
    method: request.method,
    headers: { ...request.headers, Authorization: `Bearer ${bearer}` },
    body: request.body,
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  const headers = Object.fromEntries(['content-type', 'content-disposition', 'etag', 'x-request-id']
    .map((name) => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
  return { status: response.status, headers, body: await limitedBytes(response) };
}
