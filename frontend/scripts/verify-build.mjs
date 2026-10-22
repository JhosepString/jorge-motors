import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const html = await readFile(new URL('../dist/redirect.html', import.meta.url), 'utf8');
assert.match(html, /\.js/);
assert.doesNotMatch(html, /src\/auth\/redirect\.ts/);
const entry = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.match(entry, /\.js/);
const assets = await readdir(new URL('../dist/assets/', import.meta.url));
for (const name of assets.filter((file) => file.endsWith('.js'))) {
  const code = await readFile(new URL(`../dist/assets/${name}`, import.meta.url), 'utf8');
  assert.ok(
    !code.includes('FICTICIO_NO_ES_TOKEN_VALIDO'),
    'La entrada de pruebas nunca debe incluirse en producción.',
  );
  assert.ok(
    !code.includes('REEMPLAZAR_UUID_SPA') || !process.env.VITE_ENTRA_SPA_CLIENT_ID,
    'Configure identificadores válidos antes de publicar.',
  );
}
console.info('Build verificado: aplicación y retorno MSAL separados; sin entrada de autenticación ficticia.');
