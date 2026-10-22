import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Alerta, requiereAlerta } from '../src/modules/alertas/domain/alerta.js';
import { TransactionalPublisher } from '../src/shared/transactional-publisher.js';

test('umbral inclusivo: mínimo y cero requieren alerta; por encima no', () => {
  assert.equal(requiereAlerta(2, 2), true);
  assert.equal(requiereAlerta(1, 2), true);
  assert.equal(requiereAlerta(0, 0), true);
  assert.equal(requiereAlerta(3, 2), false);
  for (const invalid of [-1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => requiereAlerta(invalid, 2));
    assert.throws(() => requiereAlerta(2, invalid));
  }
});

test('State: pendiente puede notificarse y luego atenderse', () => {
  const alert = new Alerta();
  assert.equal(alert.estado, 'PENDIENTE');
  alert.notificacionAceptada();
  assert.equal(alert.estado, 'ENVIADA');
  assert.throws(() => alert.notificacionAceptada());
  alert.atender();
  assert.equal(alert.estado, 'ATENDIDA');
  assert.throws(() => alert.atender());
  assert.throws(() => alert.notificacionAceptada());
});

test('State: reponer antes de enviar atiende la alerta sin afirmar envío', () => {
  const alert = new Alerta();
  alert.atender();
  assert.equal(alert.estado, 'ATENDIDA');
  assert.throws(() => alert.notificacionAceptada());
});

test('State: reconstruye estados persistidos y rechaza valores desconocidos', () => {
  const sent = new Alerta('ENVIADA');
  sent.atender();
  assert.equal(sent.estado, 'ATENDIDA');
  assert.throws(() => new Alerta('ATENDIDA').atender());
  assert.throws(() => new Alerta('OTRO' as never));
});

test('Observer: suscripción, orden esperado y baja sin notificar dos veces al mismo objeto', async () => {
  const publisher = new TransactionalPublisher<{ id: number }, string[]>();
  const context: string[] = [];
  const first = { actualizar: async (event: { id: number }, log: string[]) => {
    log.push(`inicio:${event.id}`); await Promise.resolve(); log.push('fin');
  } };
  const unsubscribe = publisher.suscribir(first);
  publisher.suscribir(first);
  publisher.suscribir({ actualizar: async (_, log) => { log.push('segundo'); } });
  await publisher.publicar({ id: 1 }, context);
  assert.deepEqual(context, ['inicio:1', 'fin', 'segundo']);
  unsubscribe();
  await publisher.publicar({ id: 2 }, context);
  assert.equal(context.at(-1), 'segundo');
  assert.equal(context.length, 4);
});

test('Observer: un fallo se propaga a la UoW y no continúa silenciosamente', async () => {
  const publisher = new TransactionalPublisher<number, void>();
  let nextCalls = 0;
  publisher.suscribir({ actualizar: async () => { throw new Error('Fallo del observador'); } });
  publisher.suscribir({ actualizar: async () => { nextCalls++; } });
  await assert.rejects(publisher.publicar(1, undefined), /Fallo del observador/);
  assert.equal(nextCalls, 0);
});
