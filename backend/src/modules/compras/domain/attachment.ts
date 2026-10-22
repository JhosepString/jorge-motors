import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PurchaseError } from './purchase-error.js';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_INVOICE_ATTACHMENTS = 5;
export const attachmentNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}\.(pdf|png|jpg|jpeg)$/i);
export const attachmentIdSchema = z.uuid().transform((value) => value.toLowerCase());
export type AttachmentMime = 'application/pdf' | 'image/png' | 'image/jpeg';
export function inspectAttachment(name: unknown, mime: unknown, contents: unknown) {
  if (!attachmentNameSchema.safeParse(name).success || !Buffer.isBuffer(contents) || contents.length === 0) {
    throw new PurchaseError('INVALID_ATTACHMENT', 'Revise nombre y contenido del adjunto.');
  }
  if (contents.length > MAX_ATTACHMENT_BYTES) throw new PurchaseError('ATTACHMENT_TOO_LARGE', 'El archivo supera 5 MiB.');
  const ext = (name as string).split('.').at(-1)!.toLowerCase();
  let detected: AttachmentMime | undefined;
  // Firmas básicas y terminadores. No es validación estructural completa ni antivirus.
  if (/^%PDF-[12]\.[0-9]/.test(contents.subarray(0, 8).toString('ascii'))
    && contents.subarray(-1024).toString('ascii').trimEnd().endsWith('%%EOF')) detected = 'application/pdf';
  else if (contents.length >= 32 && contents.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && contents.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) detected = 'image/png';
  else if (contents.length >= 4 && contents[0] === 255 && contents[1] === 216 && contents[2] === 255
    && contents.at(-2) === 255 && contents.at(-1) === 217) detected = 'image/jpeg';
  const expected = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
  if (!detected || detected !== mime || detected !== expected) {
    throw new PurchaseError('UNSUPPORTED_ATTACHMENT', 'Extensión, tipo y firma del archivo deben coincidir (PDF, PNG o JPEG).');
  }
  return { nombre: name as string, contentType: detected, bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'), contents };
}
