import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { inspectAttachment, MAX_ATTACHMENT_BYTES } from '../src/modules/compras/domain/attachment.js';
import { AdjuntosFacade } from '../src/modules/compras/application/adjuntos.facade.js';
import type { AttachmentUnitOfWork } from '../src/modules/compras/application/attachment-contracts.js';
import { LocalAttachmentStore } from '../src/infrastructure/storage/local-attachment-store.js';
import { runtimeServices } from '../src/infrastructure/runtime-services.js';
import { sqlPoolLimit } from '../src/infrastructure/database/sql-pool.js';
import { pdfFixture, pngFixture, tempAttachmentRoot, removeAttachmentRoot } from './helpers/attachment-fixture.js';

test('Adjuntos: firma, MIME y extensión coinciden; SHA-256 y tamaño exactos', () => {
  const p = inspectAttachment('Factura-001.pdf', 'application/pdf', pdfFixture);
  assert.match(p.sha256, /^[0-9a-f]{64}$/); assert.equal(p.bytes, pdfFixture.length);
  assert.equal(inspectAttachment('Factura.png', 'image/png', pngFixture).contentType, 'image/png');
  assert.equal(inspectAttachment('Factura.jpg', 'image/jpeg', Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')).contentType, 'image/jpeg');
});
test('Adjuntos: rechaza rutas, doble extensión, controles, HTML y contenido incompatible', () => {
  for (const name of ['../factura.pdf', 'C:\\factura.pdf', 'factura.exe.pdf', 'x:factura.pdf', 'Factura\r\n.pdf', '.pdf']) {
    assert.throws(() => inspectAttachment(name, 'application/pdf', pdfFixture), { code: 'INVALID_ATTACHMENT' });
  }
  for (const [name, mime, bytes] of [['x.pdf', 'application/pdf', Buffer.from('<html>foo</html>')],
    ['x.jpg', 'image/jpeg', pngFixture], ['x.pdf', 'image/png', pdfFixture]] as const) {
    assert.throws(() => inspectAttachment(name, mime, bytes), { code: 'UNSUPPORTED_ATTACHMENT' });
  }
});
test('Adjuntos: no admite vacío ni tamaño mayor a 5 MiB', () => {
  assert.throws(() => inspectAttachment('x.pdf', 'application/pdf', Buffer.alloc(0)), { code: 'INVALID_ATTACHMENT' });
  assert.throws(() => inspectAttachment('x.pdf', 'application/pdf', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)), { code: 'ATTACHMENT_TOO_LARGE' });
});
test('Adjuntos: datos inválidos se rechazan antes de SQL o disco', async () => {
  let calls = 0;
  const uow: AttachmentUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No debe acceder.'); } };
  const store = { putIfAbsent: async () => { calls++; }, read: async () => { calls++; return pdfFixture; }, remove: async () => { calls++; } };
  await assert.rejects(new AdjuntosFacade(uow, store).subir(1, '../x.pdf', 'application/pdf', pdfFixture, randomUUID(), 1, randomUUID()), { code: 'INVALID_ATTACHMENT' });
  assert.equal(calls, 0);
});
test('Adapter local: UUID interno, escritura exclusiva/repetible y rechazo de sobreescritura', async () => {
  const root = await tempAttachmentRoot(); const store = new LocalAttachmentStore(root); const id = randomUUID();
  try {
    await store.putIfAbsent(id, pdfFixture); await store.putIfAbsent(id, pdfFixture);
    assert.deepEqual(await store.read(id), pdfFixture); assert.equal((await readdir(root)).length, 1);
    await assert.rejects(store.putIfAbsent(id, pngFixture), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
    assert.deepEqual(await store.read(id), pdfFixture);
    for (const value of ['../outside', `${id}/../x`, 'factura.pdf']) {
      await assert.rejects(store.read(value)); await assert.rejects(store.remove(value));
    }
    await store.remove(id); await store.remove(id); assert.equal((await readdir(root)).length, 0);
  } finally { await removeAttachmentRoot(root); }
});
test('Adapter local: producción falla cerrada antes de abrir SQL o crear archivos', async () => {
  await assert.rejects(runtimeServices({ NODE_ENV: 'production' }).attachments(), { code: 'ATTACHMENT_STORAGE_NOT_CONFIGURED' });
  assert.throws(() => new LocalAttachmentStore('public/relativo'));
});
test('SQL local: pool ODBC deja margen a los trabajadores; Tedious conserva su límite', () => {
  assert.equal(sqlPoolLimit('windows', undefined), 3);
  assert.equal(sqlPoolLimit('windows', '4'), 3); assert.equal(sqlPoolLimit('windows', '2'), 1);
  assert.equal(sqlPoolLimit('windows', '1'), 1); assert.equal(sqlPoolLimit('windows', '16'), 3);
  assert.equal(sqlPoolLimit('sql', '4'), 5);
});
