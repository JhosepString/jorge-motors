# Parte 2 — Inventario y persistencia local

Fecha: 21 de octubre de 2026. Entrega del backend; todavía no incorpora interfaz React ni endpoints de negocio públicos.

## Resultado de esta parte

Se implementaron entradas y salidas mediante `InventarioFacade`, contratos Repository y adaptadores SQL. El descuento y el historial se confirman juntos; un fallo revierte ambos. Las solicitudes repetidas se reconocen por una clave de idempotencia y las salidas concurrentes se serializan por producto durante la transacción.

Motor verificado en este equipo: SQL Server Developer 2019, versión 15.0.2200.2. El esquema usa T-SQL compatible con Azure SQL; la conexión real a Azure y su identidad administrada no se han probado ni configurado en esta entrega.

## Cómo demostrarlo ahora

Desde PowerShell en `backend/`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test:sql
```

`check` verifica tipos, pruebas unitarias/HTTP y compilación. `test:sql` ejecuta pruebas con SQL real en `localhost`, usando la sesión de Windows y ODBC Driver 18. Necesita permiso para crear una base temporal; no requiere SQL Authentication ni contraseñas.

La suite SQL crea exclusivamente una base nueva llamada `jm_test_<identificador aleatorio>`, usa datos ficticios y la elimina al terminar. Su nombre se genera dentro del proceso y no proviene de `.env`; no selecciona bases existentes del usuario. Si el proceso se interrumpe abruptamente podría quedar una base temporal, cuya eliminación debe verificarse por nombre antes de proceder.

La instancia local usa memoria compartida (`lpc:localhost`), de modo que esta prueba no requiere habilitar TCP/IP ni abrir puertos. `msnodesqlv8` es un driver opcional para desarrollo local con Windows; el backend admite también `mssql`/Tedious con SQL Authentication. El modo de identidad administrada de Azure se incorporará al integrar la nube.

## Los tres patrones de esta parte

| Patrón | Problema y solución | Archivo para exponer | Prueba de evidencia |
| --- | --- | --- | --- |
| Repository | Los casos de uso no deben contener SQL. Consumen contratos que los adaptadores implementan. | `backend/src/modules/inventario/application/contracts.ts` y `backend/src/infrastructure/database/sql-inventory.ts` | Operaciones reales contra la base y rechazo de datos inválidos. |
| Facade | Registrar un movimiento requiere coordinar permisos, existencia del producto, stock e historial. Se ofrece una operación pública. | `backend/src/modules/inventario/application/inventario.facade.ts` | Entrada/salida, doble solicitud, concurrencia y rollback. |
| Singleton | Crear pools en cada operación desperdicia conexiones. Constructor privado y acceso estático controlan una instancia por proceso, con una promesa de conexión compartida. | `backend/src/infrastructure/database/sql-pool.ts` | Misma instancia y promesa, una conexión inicial y reintento tras fallo. |

`SqlInventoryUnitOfWork` aporta la frontera transaccional a la Facade. Repository separa persistencia; no es un sinónimo de ORM. La transacción y sus bloqueos son los que preservan atomicidad y consistencia; Facade coordina la operación.

## Flujo de una salida

1. Validar el DTO y la identificación interna del usuario.
2. Iniciar una transacción SQL.
3. Consultar el perfil: debe existir y estar activo. Solo Administrador puede registrar entradas; Administrador y Mecánico pueden registrar salidas.
4. Obtener un bloqueo SQL transaccional de la clave de idempotencia para ese usuario.
5. Si la solicitud ya existe con iguales datos, devolver el movimiento original. Si la clave tiene otros datos, rechazarla.
6. Consultar producto y stock con `UPDLOCK`/`HOLDLOCK` para proteger la operación concurrente.
7. Calcular el saldo con reglas puras del dominio.
8. Actualizar el stock de forma condicionada al saldo leído y guardar el movimiento.
9. Hacer commit. Ante error, rollback.

Las consultas utilizan parámetros. El historial guarda stock anterior y resultante, motivo, referencia y autor. La base protege cantidades y saldos mediante CHECK y rechaza UPDATE/DELETE de movimientos mediante un trigger.

## Reglas y límites actuales

- Cantidades enteras positivas y stock entre 0 y 2.147.483.647. Esta parte representa unidades o envases indivisibles; no admite despacho fraccionado de litros.
- Importes del esquema en `DECIMAL(18,2)`; el caso de uso actual no modifica precios ni calcula dinero en JavaScript.
- Idempotencia por usuario y UUID. Reusar una clave para otro producto, cantidad, tipo, motivo o referencia es un conflicto.
- Un usuario inactivo no puede repetir una operación ni registrar otra. Producto inactivo y producto sin stock asociado son rechazados.
- El ID del usuario es un argumento del caso de uso para pruebas internas. En Parte 3 se resolverá desde el access token validado; nunca se aceptará libremente desde el body de una ruta pública.
- Alertas, State, Observer, Outbox, facturas y envío de correo siguen pendientes. Esta entrega no genera notificaciones.
- El trigger protege frente a UPDATE/DELETE ordinarios; el administrador de la base conserva capacidad técnica de alterar el esquema. Los permisos mínimos de ejecución se definirán al desplegar.
- Las pruebas no prueban aún conexión de red a Azure, rendimiento bajo carga ni recuperación ante una caída del motor.

## Persistencia propia para desarrollo (opcional, aplicada por ti)

No necesitas una base permanente para ejecutar `test:sql`. Si deseas conservar movimientos y explorar tablas en SSMS, crea una base exclusiva en tu instancia local. El comando siguiente crea la base solo si todavía no existe; no reemplaza bases existentes:

```powershell
sqlcmd -S localhost -E -C -b -Q "IF DB_ID(N'jorge_motors_dev') IS NULL CREATE DATABASE [jorge_motors_dev];"
```

Antes de migrar una base ya existente, confirma que es la de este proyecto. Agrega a tu `.env` las siguientes variables si todavía no están; conserva las variables HTTP existentes:

```dotenv
SQL_DRIVER=windows
SQL_SERVER=localhost
SQL_DATABASE=jorge_motors_dev
SQL_TRUST_CERTIFICATE=true
```

Luego ejecuta desde `backend/`:

```powershell
pnpm.cmd db:migrate
```

La herramienta crea el esquema `jm` y registra la versión y huella de la migración. Repetirla verifica lo aplicado sin borrar datos. Una migración aplicada no se edita: los cambios futuros llevarán otra versión. La confianza del certificado solo puede habilitarse para localhost; el modo remoto valida el certificado.

Se conserva el SQL anterior de `database/schema.sql` y el Prisma SQLite como antecedentes. La nueva migración está en `database/azure-sql/migrations/001_inventory.sql`: crea solo los objetos de esta parte. No incluye todavía proveedores, facturas y alertas. No mezclar los esquemas históricos con este esquema parcial.

## Decisión de persistencia (ADR-002)

**Contexto:** el diseño anterior consideraba Prisma/SQLite y PostgreSQL. El destino acordado ahora es Azure SQL; se necesita demostrar concurrencia y transacciones sobre el motor de destino o uno compatible.

**Decisión:** `node-mssql`, con contratos Repository y transacciones explícitas. Para Windows local se usa el adaptador opcional `msnodesqlv8`; para el entorno Linux se usará Tedious y se resolverá la autenticación Entra del recurso al integrar Azure.

**Consecuencias:** consultas parametrizadas y migraciones T-SQL explícitas, más control visible del SQL y más responsabilidad de mantenimiento. La instancia de pool se reutiliza por proceso. La elección no convierte las credenciales SQL en la estrategia final de Azure: la identidad administrada continúa siendo el objetivo y requiere integración posterior.

Fuentes de implementación: [node-mssql](https://github.com/tediousjs/node-mssql) y [bloqueos de actualización de SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver17).

## Cierre y siguiente parte

La Parte 2 se considera completa cuando pasen los tipos, compilación, pruebas unitarias/HTTP e integración SQL. La ejecución real se registra en la bitácora. La siguiente parte será autenticación y autorización con Entra ID; hasta entonces la API HTTP conserva únicamente el health público.
