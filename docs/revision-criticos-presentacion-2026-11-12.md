# Jorge Motors: estado para la presentación del 12/11/2026

## Listo y comprobado

- **Instalador Windows 0.1.8:** `desktop/release/Jorge Motors Setup 0.1.8.exe`. Se instaló silenciosamente en el equipo de prueba y el ejecutable instalado informó versión 0.1.8.0.
- **API en Azure:** publicada con la nueva administración de perfiles; la prueba autenticada con un administrador devolvió cinco perfiles y el tipo de una herramienta. El estado `/ready` respondió correctamente.
- **Transporte seguro:** la aplicación web de Azure obliga a usar HTTPS; una solicitud HTTP recibió redirección a HTTPS.
- **Herramientas:** las 100 herramientas del catálogo de prueba están clasificadas como tales. La interfaz y la API impiden registrar una salida ordinaria; existe además una protección en la base de datos. La prueba local confirmó que un intento rechazado no consume cupo ni crea una operación pendiente.
- **Usuarios:** el administrador puede ver, crear, activar o desactivar perfiles en Jorge Motors y asignar el rol de Mecánico o Administrador. La pantalla explica que la cuenta y el rol de aplicación en Microsoft Entra se configuran allí por separado.
- **Modo local:** la aplicación muestra las operaciones rechazadas y su motivo para facilitar la revisión del administrador.
- **Datos de prueba:** la aplicación identifica visiblemente el inventario ficticio cargado en Azure SQL.
- **Pruebas automáticas:** 118 pruebas del backend pasaron; la compilación y las pruebas de interfaz y escritorio habían pasado antes del empaquetado final. El instalador 0.1.8 compiló sin errores.

## Demostración sugerida

1. Instalar la versión 0.1.8 y abrir Jorge Motors desde el acceso directo.
2. Entrar con Microsoft usando un usuario Administrador y mostrar el inventario ficticio.
3. Abrir **Usuarios** y mostrar los cinco perfiles registrados. No crear cuentas de compañeros durante la demostración si no están preparados en Microsoft Entra.
4. Buscar una herramienta y mostrar que se identifica como herramienta y no permite una salida común.
5. Abrir un producto de repuesto, registrar un movimiento de prueba y comprobar el stock.
6. Explicar el modo local y la lista de operaciones pendientes o rechazadas, si existe alguna.

## Pendiente después de la presentación

- Implementar préstamos y devoluciones de herramientas, con responsable, fecha, estado y trazabilidad. Hoy se bloquea su consumo como salida común.
- Integrar el alta y retiro de usuarios con Microsoft Entra, o documentar un procedimiento administrativo único. Hoy son dos pasos: Entra y perfil Jorge Motors.
- Añadir un flujo de resolución para operaciones locales rechazadas. Hoy se visualizan, pero un administrador debe conciliarlas.
- Separar los datos ficticios de los datos reales antes de usar el sistema en producción.
- Firmar digitalmente el instalador para una distribución formal.
