import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ContainerClient } from '@azure/storage-blob';
import { BlobAttachmentStore, managedBlobStore, parseBlobSettings } from '../src/infrastructure/storage/blob-attachment-store.js';
import { MAX_ATTACHMENT_BYTES } from '../src/modules/compras/domain/attachment.js';
import { runtimeServices } from '../src/infrastructure/runtime-services.js';

function fakeContainer() {
  const objects = new Map<string, Buffer>();
  const names: string[] = [];
  const container = {
    getBlockBlobClient(name: string) {
      names.push(name);
      return {
        async uploadData(contents: Buffer, options: { conditions: { ifNoneMatch: string }; blobHTTPHeaders: { blobContentType: string } }) {
          assert.equal(options.conditions.ifNoneMatch, '*');
          assert.equal(options.blobHTTPHeaders.blobContentType, 'application/octet-stream');
          if (objects.has(name)) throw { statusCode: 412 };
          objects.set(name, Buffer.from(contents));
        },
        async getProperties() {
          const item = objects.get(name);
          if (!item) throw { statusCode: 404 };
          return { contentLength: item.length, etag: `"${createHash('sha256').update(item).digest('hex')}"` };
        },
        async downloadToBuffer(_offset: number, length: number, options: { conditions: { ifMatch: string } }) {
          const item = objects.get(name);
          if (!item) throw { statusCode: 404 };
          assert.equal(options.conditions.ifMatch, `"${createHash('sha256').update(item).digest('hex')}"`);
          return Buffer.from(item.subarray(0, length));
        },
        async deleteIfExists(options: { deleteSnapshots: string }) {
          assert.equal(options.deleteSnapshots, 'include');
          objects.delete(name);
        },
      };
    },
  } as unknown as ContainerClient;
  return { container, objects, names };
}

test('Blob: configuración admite solo cuenta/contenedor válidos e identidad administrada opcional', () => {
  const settings = parseBlobSettings({ BLOB_ACCOUNT_NAME: 'jorgemotorsdemo' });
  assert.equal(settings.BLOB_CONTAINER_NAME, 'facturas');
  assert.doesNotThrow(() => managedBlobStore(settings)); // Construir cliente no contacta Azure.
  assert.equal(parseBlobSettings({ BLOB_ACCOUNT_NAME: 'jorgemotorsdemo', BLOB_MANAGED_IDENTITY_CLIENT_ID: randomUUID() }).BLOB_ACCOUNT_NAME, 'jorgemotorsdemo');
  for (const env of [{}, { BLOB_ACCOUNT_NAME: 'https://otro.example/' },
    { BLOB_ACCOUNT_NAME: 'jorgemotorsdemo', BLOB_CONTAINER_NAME: 'x--y' },
    { BLOB_ACCOUNT_NAME: 'jorgemotorsdemo', BLOB_MANAGED_IDENTITY_CLIENT_ID: 'no-uuid' }]) {
    assert.throws(() => parseBlobSettings(env));
  }
});

test('Blob: creación exclusiva, reintento con el mismo contenido y rechazo de sobrescritura', async () => {
  const { container, objects, names } = fakeContainer();
  const store = new BlobAttachmentStore(container);
  const id = randomUUID();
  const first = Buffer.from('%PDF-1.4\n%%EOF');
  await store.putIfAbsent(id, first);
  await store.putIfAbsent(id, Buffer.from(first));
  assert.deepEqual(await store.read(id), first);
  await assert.rejects(store.putIfAbsent(id, Buffer.from('otro')), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
  assert.deepEqual(objects.get(`${id}.bin`), first);
  assert(names.every((name) => name === `${id}.bin`));
  await store.remove(id); await store.remove(id);
  await assert.rejects(store.read(id), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
});

test('Blob: IDs y tamaños inválidos fallan sin descargar objetos grandes', async () => {
  const { container, objects, names } = fakeContainer();
  const store = new BlobAttachmentStore(container);
  const id = randomUUID();
  await assert.rejects(store.putIfAbsent(id, Buffer.alloc(0)), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
  await assert.rejects(store.putIfAbsent(id, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
  await assert.rejects(store.read('../fuera'), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
  assert.equal(names.length, 0);
  objects.set(`${id}.bin`, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  await assert.rejects(store.read(id), { code: 'ATTACHMENT_STORAGE_UNAVAILABLE' });
});

test('Producción mantiene adjuntos cerrados si falta la configuración Blob', async () => {
  await assert.rejects(runtimeServices({ NODE_ENV: 'production' }).attachments(), { code: 'ATTACHMENT_STORAGE_NOT_CONFIGURED' });
  await assert.rejects(runtimeServices({ NODE_ENV: 'production', ATTACHMENT_STORAGE: 'local' }).attachments(), { code: 'ATTACHMENT_STORAGE_NOT_CONFIGURED' });
  await assert.rejects(runtimeServices({ NODE_ENV: 'production', ATTACHMENT_STORAGE: 'blob' }).attachments(), { code: 'ATTACHMENT_STORAGE_NOT_CONFIGURED' });
});
