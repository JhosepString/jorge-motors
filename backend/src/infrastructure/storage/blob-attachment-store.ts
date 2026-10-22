import { createHash, timingSafeEqual } from 'node:crypto';
import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { z } from 'zod';
import type { AttachmentStore } from '../../modules/compras/application/attachment-contracts.js';
import { MAX_ATTACHMENT_BYTES } from '../../modules/compras/domain/attachment.js';
import { PurchaseError } from '../../modules/compras/domain/purchase-error.js';

const schema = z.object({
  BLOB_ACCOUNT_NAME: z.string().regex(/^[a-z0-9]{3,24}$/),
  BLOB_CONTAINER_NAME: z.string().regex(/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/).default('facturas'),
  BLOB_MANAGED_IDENTITY_CLIENT_ID: z.uuid().optional(),
});

export type BlobSettings = z.infer<typeof schema>;
export function parseBlobSettings(env: NodeJS.ProcessEnv): BlobSettings {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error('Configuración de Azure Blob inválida.');
  return result.data;
}

export function managedBlobStore(settings: BlobSettings): BlobAttachmentStore {
  // Se usa exclusivamente la identidad administrada del proceso en Azure.
  // No se aceptan cadenas de conexión, Shared Key ni SAS en configuración.
  const credential = settings.BLOB_MANAGED_IDENTITY_CLIENT_ID
    ? new ManagedIdentityCredential(settings.BLOB_MANAGED_IDENTITY_CLIENT_ID)
    : new ManagedIdentityCredential();
  const service = new BlobServiceClient(
    `https://${settings.BLOB_ACCOUNT_NAME}.blob.core.windows.net`, credential,
    { retryOptions: { maxTries: 2, retryDelayInMs: 500, maxRetryDelayInMs: 1000 } },
  );
  return new BlobAttachmentStore(service.getContainerClient(settings.BLOB_CONTAINER_NAME));
}

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = (data: Buffer) => createHash('sha256').update(data).digest();
const unavailable = () => new PurchaseError('ATTACHMENT_STORAGE_UNAVAILABLE', 'El almacenamiento privado no está disponible.');
const storageCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? error.code : undefined;
const storageStatus = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;

export class BlobAttachmentStore implements AttachmentStore {
  constructor(private readonly container: ContainerClient) {}

  private blob(id: string) {
    if (!idPattern.test(id)) throw new Error('ID de objeto inválido.');
    return this.container.getBlockBlobClient(`${id}.bin`);
  }

  async putIfAbsent(id: string, contents: Buffer): Promise<void> {
    if (contents.length < 1 || contents.length > MAX_ATTACHMENT_BYTES) throw unavailable();
    try {
      await this.blob(id).uploadData(contents, {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
        abortSignal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      if (storageStatus(error) === 412 || (storageStatus(error) === 409 && storageCode(error) === 'BlobAlreadyExists')) {
        const previous = await this.read(id);
        if (previous.length === contents.length && timingSafeEqual(digest(previous), digest(contents))) return;
      }
      throw unavailable();
    }
  }

  async read(id: string): Promise<Buffer> {
    try {
      const blob = this.blob(id);
      const properties = await blob.getProperties({ abortSignal: AbortSignal.timeout(12_000) });
      const length = properties.contentLength;
      if (!Number.isSafeInteger(length) || !length || length > MAX_ATTACHMENT_BYTES || !properties.etag) throw new Error('Objeto inválido.');
      const contents = await blob.downloadToBuffer(0, length, {
        conditions: { ifMatch: properties.etag }, abortSignal: AbortSignal.timeout(12_000),
      });
      if (contents.length !== length) throw new Error('Lectura incompleta.');
      return contents;
    } catch { throw unavailable(); }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.blob(id).deleteIfExists({ deleteSnapshots: 'include', abortSignal: AbortSignal.timeout(12_000) });
    } catch { throw unavailable(); }
  }
}
