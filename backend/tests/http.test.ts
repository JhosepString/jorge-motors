import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.js';
import { requestContext } from '../src/middleware/request-context.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { Logger } from '../src/shared/logger.js';

function fixture() {
  const entries: Record<string, unknown>[] = [];
  const logger: Logger = { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) };
  return { app: createApp(parseEnvironment({ NODE_ENV: 'test' }), logger), entries, logger };
}

test('health responde sin base de datos y genera identificador de seguimiento', async () => {
  const { app, entries } = fixture();
  const res = await request(app).get('/api/v1/health').expect(200);
  assert.deepEqual(res.body, { status: 'ok', service: 'jorge-motors-api' });
  const requestId = res.headers['x-request-id'];
  assert.ok(requestId);
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(entries[0]?.requestId, res.headers['x-request-id']);
});

test('ruta inexistente devuelve error uniforme con el mismo requestId', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/v1/productos').expect(404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  assert.equal(res.body.error.requestId, res.headers['x-request-id']);
});

test('permite el origen configurado y la preflight del navegador', async () => {
  const { app } = fixture();
  const res = await request(app).options('/api/v1/health')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'GET').expect(204);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('origen rechazado interrumpe la cadena antes de ejecutar health', async () => {
  const { app, entries } = fixture();
  const res = await request(app).get('/api/v1/health')
    .set('Origin', 'https://otro.example').expect(403);
  assert.equal(res.body.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(res.body.status, undefined);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(entries[0]?.status, 403);
});

test('JSON mal formado llega al manejador de errores antes de las rutas', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/v1/productos')
    .set('Content-Type', 'application/json').send('{').expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('rechaza cuerpos JSON de más de 64 KB', async () => {
  const { app } = fixture();
  const res = await request(app).post('/api/v1/productos')
    .send({ contenido: 'a'.repeat(70_000) }).expect(413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('errores asíncronos no filtran mensajes sensibles y la API sigue respondiendo', async () => {
  const { logger, entries } = fixture();
  const app = express();
  app.use(requestContext(logger));
  app.get('/fallo', async () => { throw new Error('Password=secreto-de-prueba'); });
  app.get('/ok', (_req, res) => { res.sendStatus(200); });
  app.use(errorHandler(logger));
  const res = await request(app).get('/fallo').expect(500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(res.body).includes('secreto'), false);
  assert.equal(JSON.stringify(entries).includes('secreto'), false);
  await request(app).get('/ok').expect(200);
});

test('la configuración rechaza puertos inválidos y orígenes con rutas', () => {
  assert.throws(() => parseEnvironment({ PORT: '70000' }), /PORT/);
  assert.throws(() => parseEnvironment({ FRONTEND_ORIGIN: 'https://ejemplo.com/ruta' }), /FRONTEND_ORIGIN/);
  assert.equal(parseEnvironment({}).PORT, 3000);
});
