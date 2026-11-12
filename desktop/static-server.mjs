import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export async function startStaticServer(root, port = 0) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = resolve(base, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (path !== base && !path.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
      let file = path;
      try { if (!(await stat(file)).isFile()) throw new Error('not file'); }
      catch {
        if (url.pathname.startsWith('/assets/') || url.pathname.includes('.')) { response.writeHead(404); response.end(); return; }
        file = resolve(base, 'index.html');
      }
      const bytes = await readFile(file);
      const suffix = file.slice(file.lastIndexOf('.'));
      response.writeHead(200, { 'Content-Type': types[suffix] ?? 'application/octet-stream',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return { server, origin: `http://localhost:${server.address().port}` };
}
