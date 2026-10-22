import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { generateKeyPair, type JWTPayload } from 'jose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.js';
import { parseEntraSettings } from '../src/modules/auth/infrastructure/entra.js';
import type { UserProfile } from '../src/modules/auth/application/contracts.js';
import type { AuditEvent } from '../src/modules/auditoria/application/contracts.js';
import type { InventarioFacade } from '../src/modules/inventario/application/inventario.facade.js';
import type { BackendServices } from '../src/services.js';
import { tenantId, apiId, objectId, signTestToken, testVerifier } from './helpers/entra-fixture.js';

function fixture(options: { profile?: Partial<UserProfile>; missingProfile?: boolean; auditFails?: boolean } = {}) {
  const audit: AuditEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  let lookups = 0;
  let operations = 0;
  const profile: UserProfile = {
    id: 7, nombres: 'Empleado ficticio', rol: 'ADMINISTRADOR', activo: true,
    entraTenantId: tenantId, entraObjectId: objectId, ...options.profile,
  };
  const services: BackendServices = {
    inventoryRead: async () => { throw new Error('No se usan lecturas aquí.'); },
    reports: async () => { throw new Error('No se usan reportes en estas pruebas.'); },
    attachments: async () => { throw new Error('No se usan adjuntos en estas pruebas.'); },
    invoices: async () => { throw new Error('No se usan facturas en estas pruebas.'); },
    suppliers: async () => { throw new Error('No se usan proveedores en estas pruebas.'); },
    catalog: async () => { throw new Error('No se usa catálogo en estas pruebas.'); },
    verifyToken: testVerifier,
    profiles: { buscarIdentidad: async () => { lookups++; return options.missingProfile ? undefined : profile; } },
    audit: { registrar: async (event) => { if (options.auditFails) throw new Error('Sin auditoría SQL'); audit.push(event); } },
    inventory: async () => {
      operations++;
      // Estas pruebas verifican la cadena HTTP; la transacción real se prueba con SQL.
      return {
        registrarSalida: async (input: unknown, userId: number) => ({ movimiento: { id: 1, usuarioId: userId, requestHash: 'internal', input }, repetido: false }),
        registrarEntrada: async (input: unknown, userId: number) => ({ movimiento: { id: 1, usuarioId: userId, requestHash: 'internal', input }, repetido: false }),
      } as unknown as InventarioFacade;
    },
  };
  const app = createApp(parseEnvironment({ NODE_ENV: 'test' }), {
    info: (entry) => logs.push(entry), error: (entry) => logs.push(entry),
  }, services);
  return { app, audit, logs, operations: () => operations, lookups: () => lookups };
}
const body = { productoId: 1, cantidad: 2, motivo: 'Uso en taller' };

test('sin Bearer se responde 401 y se audita sin atribuir identidad', async () => {
  const f = fixture();
  const res = await request(f.app).post('/api/v1/inventario/salidas').send(body).expect(401);
  assert.equal(res.headers['www-authenticate'], 'Bearer');
  assert.equal(f.lookups(), 0);
  assert.equal(f.audit[0]?.userId, null);
  assert.equal(f.audit[0]?.objectId, null);
  assert.equal(f.audit[0]?.requestId, res.headers['x-request-id']);
});

for (const [label, claims] of [
  ['token expirado', { exp: Math.floor(Date.now() / 1000) - 60 }],
  ['audiencia de otra API', { aud: randomUUID() }],
  ['emisor de otro tenant', { iss: 'https://login.microsoftonline.com/otro/v2.0' }],
  ['claim tenant distinto', { tid: randomUUID() }],
  ['versión 1.0', { ver: '1.0' }],
  ['identidad sin object ID válido', { oid: 'no-es-uuid' }],
] as Array<[string, JWTPayload]>) {
  test(`${label}: rechazo 401 antes del acceso a datos`, async () => {
    const f = fixture();
    const token = await signTestToken(claims);
    await request(f.app).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(401);
    assert.equal(f.lookups(), 0);
    assert.equal(f.audit[0]?.objectId, null);
  });
}

test('la firma de otra clave se rechaza y no se registra el token en logs', async () => {
  const f = fixture();
  const other = await generateKeyPair('RS256');
  const token = await signTestToken({}, other.privateKey);
  await request(f.app).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(401);
  assert.equal(f.lookups(), 0);
  assert.equal(JSON.stringify([f.logs, f.audit]).includes(token), false);
});

for (const [label, claims] of [
  ['cliente sin autorización', { azp: randomUUID() }],
  ['scope ausente', { scp: '' }],
  ['token app-only', { scp: undefined }],
  ['sin rol de aplicación', { roles: [] }],
] as Array<[string, JWTPayload]>) {
  test(`${label}: rechazo 403 antes de consultar el perfil`, async () => {
    const f = fixture();
    await request(f.app).get('/api/v1/auth/me').auth(await signTestToken(claims), { type: 'bearer' }).expect(403);
    assert.equal(f.lookups(), 0);
  });
}

test('un perfil ausente o inactivo bloquea el acceso aunque el token sea válido', async () => {
  const token = await signTestToken();
  for (const options of [{ missingProfile: true }, { profile: { activo: false } }]) {
    const f = fixture(options);
    await request(f.app).get('/api/v1/auth/me').auth(token, { type: 'bearer' }).expect(403);
    assert.equal(f.operations(), 0);
  }
});

test('un rol Entra distinto al perfil local se rechaza', async () => {
  const f = fixture();
  const res = await request(f.app).get('/api/v1/auth/me')
    .auth(await signTestToken({ roles: ['Mecanico'] }), { type: 'bearer' }).expect(403);
  assert.equal(res.body.error.code, 'ROLE_MISMATCH');
});

test('mecánico no puede registrar entradas: la cadena se detiene antes de Facade', async () => {
  const f = fixture({ profile: { rol: 'MECANICO' } });
  await request(f.app).post('/api/v1/inventario/entradas')
    .auth(await signTestToken({ roles: ['Mecanico'] }), { type: 'bearer' })
    .set('Idempotency-Key', randomUUID()).send(body).expect(403);
  assert.equal(f.operations(), 0);
  assert.equal(f.audit[0]?.userId, 7);
  assert.equal(f.audit[0]?.code, 'ROLE_FORBIDDEN');
});

test('perfil permitido se consulta sin exponer claims o campos internos', async () => {
  const f = fixture();
  const res = await request(f.app).get('/api/v1/auth/me')
    .auth(await signTestToken(), { type: 'bearer' }).expect(200);
  assert.deepEqual(res.body.data, { id: 7, nombres: 'Empleado ficticio', rol: 'ADMINISTRADOR' });
  assert.equal(f.audit[0]?.action, 'CONSULTA_PERFIL');
});

test('administrador entra y mecánico sale; la identidad no viene del cuerpo', async () => {
  for (const [role, appRole, path] of [
    ['ADMINISTRADOR', 'Administrador', 'entradas'], ['MECANICO', 'Mecanico', 'salidas'],
  ] as const) {
    const f = fixture({ profile: { rol: role } });
    const res = await request(f.app).post(`/api/v1/inventario/${path}`)
      .auth(await signTestToken({ roles: [appRole] }), { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send(body).expect(201);
    assert.equal(res.body.data.usuarioId, 7);
    assert.equal(res.body.data.requestHash, undefined);
  }
});

test('un usuarioId inyectado, cantidad inválida o falta de clave se rechazan sin ejecutar Facade', async () => {
  for (const data of [{ ...body, usuarioId: 999 }, { ...body, cantidad: -1 }, body]) {
    const f = fixture();
    await request(f.app).post('/api/v1/inventario/salidas')
      .auth(await signTestToken(), { type: 'bearer' }).send(data).expect(400);
    assert.equal(f.operations(), 0);
  }
});

test('si falla persistir un rechazo se deja respaldo sanitizado y se conserva el 401', async () => {
  const f = fixture({ auditFails: true });
  await request(f.app).post('/api/v1/inventario/salidas').send({ password: 'dato-no-auditable' }).expect(401);
  const event = f.logs.find((entry) => entry.event === 'audit_persistence_failed');
  assert.equal(event?.destination, 'console_fallback');
  assert.equal(JSON.stringify(f.logs).includes('dato-no-auditable'), false);
});

test('sin configuración no hay bypass de autenticación y health permanece público', async () => {
  const app = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} });
  await request(app).get('/api/v1/health').expect(200);
  await request(app).get('/api/v1/auth/me').auth('token', { type: 'bearer' }).expect(503);
});

test('configuración parcial de Entra falla; completamente ausente permite solo iniciar la base HTTP', () => {
  assert.equal(parseEntraSettings({}), undefined);
  assert.throws(() => parseEntraSettings({ ENTRA_TENANT_ID: tenantId }));
  assert.throws(() => parseEntraSettings({ ENTRA_TENANT_ID: tenantId, ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: '*' }));
});
