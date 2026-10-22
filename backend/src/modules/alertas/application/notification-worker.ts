import { z } from 'zod';

export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const NOTIFICATION_LEASE_SECONDS = 120;
const basePayload = z.object({
  alertaId: z.number().int().positive(), productoId: z.number().int().positive(),
  movimientoId: z.number().int().positive(), sku: z.string().min(1).max(40),
  nombre: z.string().min(1).max(150), stock: z.number().int().nonnegative(),
  minimo: z.number().int().nonnegative(),
}).strict();
const movementPayload = basePayload.refine((value) => value.stock <= value.minimo);
const catalogPayload = basePayload.extend({ movimientoId: z.null(), origen: z.literal('CATALOGO') })
  .refine((value) => value.stock <= value.minimo);
export type NotificationPayload = z.infer<typeof movementPayload> | z.infer<typeof catalogPayload>;
export interface ClaimedNotification {
  id: string; alertaId: number; leaseToken: string; intento: number; payload: string; version: number;
}
export type NotificationErrorCode = 'INVALID_PAYLOAD' | 'TRANSPORT_TIMEOUT' | 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE';
export interface NotificationDispatchRepository {
  reclamar(): Promise<ClaimedNotification | undefined>;
  vigente(task: ClaimedNotification): Promise<boolean>;
  aceptar(task: ClaimedNotification, providerId: string): Promise<boolean>;
  fallar(task: ClaimedNotification, code: NotificationErrorCode, retrySeconds: number | null): Promise<boolean>;
}
export interface NotificationTransport {
  // La clave estable debe propagarse al proveedor si admite idempotencia.
  enviar(message: NotificationPayload & { idempotencyKey: string }, signal: AbortSignal): Promise<{ providerId: string }>;
}
export class NotificationFailure extends Error {
  constructor(readonly code: 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE') { super(code); }
}
export function retryDelaySeconds(attempt: number, random = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_NOTIFICATION_ATTEMPTS) throw new Error('Intento inválido.');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Jitter inválido.');
  return Math.min(3600, Math.ceil(60 * 2 ** (attempt - 1) * (0.8 + sample * 0.4)));
}
export type DispatchResult = 'VACIA' | 'OBSOLETA' | 'ACEPTADA' | 'ACEPTACION_NO_CONFIRMADA' | 'REINTENTO' | 'AGOTADA';

export class NotificationWorker {
  constructor(
    private readonly repository: NotificationDispatchRepository,
    private readonly transport: NotificationTransport,
    private readonly timeoutMs = 30_000,
    private readonly random = Math.random,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Timeout inválido.');
  }

  async procesarUna(): Promise<DispatchResult> {
    const task = await this.repository.reclamar();
    if (!task) return 'VACIA';
    if (!await this.repository.vigente(task)) return 'OBSOLETA';
    let payload: NotificationPayload;
    try {
      const raw = JSON.parse(task.payload);
      if (task.version !== 1 && task.version !== 2) throw new Error('Versión no soportada.');
      payload = task.version === 1 ? movementPayload.parse(raw) : catalogPayload.parse(raw);
      if (payload.alertaId !== task.alertaId) throw new Error('Alerta incompatible.');
    } catch {
      return await this.repository.fallar(task, 'INVALID_PAYLOAD', null) ? 'AGOTADA' : 'OBSOLETA';
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let receipt: { providerId: string };
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('TRANSPORT_TIMEOUT'));
        }, this.timeoutMs);
      });
      receipt = await Promise.race([
        this.transport.enviar({ ...payload, idempotencyKey: task.id }, controller.signal), deadline,
      ]);
      if (!receipt || typeof receipt.providerId !== 'string' || !receipt.providerId.trim()
        || receipt.providerId.length > 200) throw new NotificationFailure('PERMANENT_FAILURE');
    } catch (error) {
      const code: NotificationErrorCode = controller.signal.aborted ? 'TRANSPORT_TIMEOUT'
        : error instanceof NotificationFailure ? error.code : 'TEMPORARY_FAILURE';
      const terminal = code === 'PERMANENT_FAILURE' || task.intento >= MAX_NOTIFICATION_ATTEMPTS;
      const saved = await this.repository.fallar(task, code, terminal ? null : retryDelaySeconds(task.intento, this.random));
      return !saved ? 'OBSOLETA' : terminal ? 'AGOTADA' : 'REINTENTO';
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    // No envolver en el catch del transporte: si falla confirmar en SQL, NO afirmar fallo de envío.
    // Se conserva el lease; tras expirar podría repetirse el envío (at-least-once).
    return await this.repository.aceptar(task, receipt.providerId) ? 'ACEPTADA' : 'ACEPTACION_NO_CONFIRMADA';
  }

  async procesarLote(limite = 10): Promise<DispatchResult[]> {
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new Error('Límite inválido.');
    const results: DispatchResult[] = [];
    for (let i = 0; i < limite; i++) {
      const result = await this.procesarUna();
      results.push(result);
      if (result === 'VACIA') break;
    }
    return results;
  }
}
