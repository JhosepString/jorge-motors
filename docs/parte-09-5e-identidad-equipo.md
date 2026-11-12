# Parte 9.5e — Identidad criptográfica del equipo

**Estado:** implementada y probada con SQL Server local efímero; pendiente de validar con Entra ID y Azure SQL reales.

El primer arranque genera una clave P-256 para la instalación. Electron guarda la clave privada mediante `safeStorage` en el perfil de Windows; la API recibe solamente la clave pública. Después de iniciar sesión con Entra ID, el escritorio registra el identificador del equipo y su clave pública. El registro es repetible con la misma clave, pero rechaza otra clave para el mismo identificador. La [Parte 9.5f](parte-09-5f-revocacion-equipo.md) incorpora la revocación; la reconciliación de cupos retenidos todavía está pendiente.

Las solicitudes de descarga, sincronización y emisión de permiso offline incluyen identificador, hora, nonce y firma del método, ruta y cuerpo. La API verifica la firma con la clave registrada, exige un token Entra válido y comprueba el tenant y rol del usuario. La hora admite dos minutos de diferencia. El reparto de cupo exige que el equipo esté registrado. El nonce evita firmas idénticas, pero aún no hay almacenamiento de nonces usados: una solicitud capturada puede repetirse durante la ventana. La sincronización conserva su clave de idempotencia para evitar duplicar movimientos.

La firma acredita una instalación, no identifica a una persona. El permiso offline sigue vinculado al usuario y al equipo. La [Parte 9.7](parte-09-7-continuidad-offline.md) modifica su duración para sostener cortes prolongados y documenta el límite de revocación mientras no hay red.

**Verificación:** firma alterada, clave incorrecta, ruta/cuerpo distintos, firma caducada, registro repetido, intento de sustituir la clave, descarga sin firma y descarga firmada. Pruebas unitarias, SQL efímero y escritorio. No se modificó Azure.
