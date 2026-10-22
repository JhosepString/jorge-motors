import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NotificationWorker, NotificationFailure, retryDelaySeconds,
  type ClaimedNotification, type NotificationDispatchRepository, type NotificationTransport,
} from '../src/modules/alertas/application/notification-worker.js';

function fixture() {
  const task: ClaimedNotification = { id: randomUUID(), alertaId: 1, leaseToken: randomUUID(), intento: 1, version: 1,
    payload: JSON.stringify({ alertaId: 1, productoId: 1, movimientoId: 1, sku: 'DEMO', nombre: 'Ficticio', stock: 2, minimo: 2 }) };
  const calls: Array<unknown[]> = [];
  const repository: NotificationDispatchRepository = {
    reclamar: async () => task, vigente: async () => true,
    aceptar: async (...args) => { calls.push(['aceptar', ...args]); return true; },
    fallar: async (...args) => { calls.push(['fallar', ...args]); return true; },
  };
  const transport: NotificationTransport = { enviar: async (message) => {
    calls.push(['enviar', message.idempotencyKey]); return { providerId: 'FICTICIO' };
  } };
  return { task, calls, repository, transport };
}

test('Worker: cola vacía termina un lote sin invocar transporte', async () => {
  const f = fixture(); f.repository.reclamar = async () => undefined;
  assert.deepEqual(await new NotificationWorker(f.repository, f.transport).procesarLote(), ['VACIA']);
  assert.equal(f.calls.length, 0);
});
test('Worker: envía con clave estable y confirma aceptación solo después del transporte', async () => {
  const f = fixture();
  assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'ACEPTADA');
  assert.deepEqual(f.calls.map((call) => call[0]), ['enviar', 'aceptar']);
  assert.equal(f.calls[0]![1], f.task.id);
});
test('Worker: reserva obsoleta no envía ni confirma', async () => {
  const f = fixture(); f.repository.vigente = async () => false;
  assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'OBSOLETA');
  assert.equal(f.calls.length, 0);
});
test('Worker: payload inválido no llega al transporte y agota sin guardar datos sensibles del error', async () => {
  for (const payload of ['not-json', '{}', '{"alertaId":999}', fixture().task.payload.replace('"alertaId":1', '"alertaId":2')]) {
    const f = fixture(); f.task.payload = payload;
    assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'AGOTADA');
    assert.deepEqual(f.calls[0]!.slice(2), ['INVALID_PAYLOAD', null]);
    assert.equal(f.calls.length, 1);
  }
});
test('Worker: fallo temporal agenda reintento; quinto fallo y fallo permanente agotan', async () => {
  for (const [attempt, code, expected] of [[1, 'TEMPORARY_FAILURE', 'REINTENTO'], [5, 'TEMPORARY_FAILURE', 'AGOTADA'],
    [1, 'PERMANENT_FAILURE', 'AGOTADA']] as const) {
    const f = fixture(); f.task.intento = attempt;
    f.transport.enviar = async () => { throw new NotificationFailure(code); };
    assert.equal(await new NotificationWorker(f.repository, f.transport, 30_000, () => 0.5).procesarUna(), expected);
    assert.equal(f.calls[0]![0], 'fallar');
    assert.equal(f.calls[0]![3], expected === 'AGOTADA' ? null : 60);
  }
});
test('Worker: timeout aborta el transporte y programa reintento acotado', async () => {
  const f = fixture(); let aborted = false;
  f.transport.enviar = async (_, signal) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; });
  });
  assert.equal(await new NotificationWorker(f.repository, f.transport, 5).procesarUna(), 'REINTENTO');
  assert.equal(aborted, true);
  assert.equal(f.calls[0]![2], 'TRANSPORT_TIMEOUT');
});
test('Worker: aceptación externa con fallo SQL no se registra como fallo del transporte', async () => {
  const f = fixture(); f.repository.aceptar = async () => { throw new Error('SQL no disponible'); };
  await assert.rejects(new NotificationWorker(f.repository, f.transport).procesarUna(), /SQL no disponible/);
  assert.deepEqual(f.calls.map((call) => call[0]), ['enviar']);
  f.repository.aceptar = async () => false;
  assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'ACEPTACION_NO_CONFIRMADA');
});
test('Worker: backoff exponencial con jitter y límites de lote/configuración', async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((attempt) => retryDelaySeconds(attempt, () => 0.5)), [60, 120, 240, 480, 960]);
  assert.equal(retryDelaySeconds(1, () => 0), 48);
  assert.equal(retryDelaySeconds(1, () => 0.999), 72);
  for (const invalid of [0, 6, 1.5]) assert.throws(() => retryDelaySeconds(invalid));
  assert.throws(() => retryDelaySeconds(1, () => 1));
  const f = fixture();
  for (const invalid of [0, 60_001]) assert.throws(() => new NotificationWorker(f.repository, f.transport, invalid));
  await assert.rejects(new NotificationWorker(f.repository, f.transport).procesarLote(101));
});

test('Worker: conserva compatibilidad V1 y acepta V2 de catálogo con movimiento nulo', async () => {
  const f = fixture(); f.task.version = 2;
  f.task.payload = JSON.stringify({ ...JSON.parse(f.task.payload), movimientoId: null, origen: 'CATALOGO' });
  assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'ACEPTADA');
});
test('Worker: versión desconocida o payload de otra versión no llega al transporte', async () => {
  for (const version of [2, 3]) {
    const f = fixture(); f.task.version = version; // Payload V1, incompatible con V2/V3.
    assert.equal(await new NotificationWorker(f.repository, f.transport).procesarUna(), 'AGOTADA');
    assert.equal(f.calls[0]![0], 'fallar'); assert.equal(f.calls.length, 1);
  }
});
