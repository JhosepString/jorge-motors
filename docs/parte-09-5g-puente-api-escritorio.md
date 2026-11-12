# Parte 9.5g — Acceso a la API desde el frontend local

**Estado:** puente Electron implementado y probado localmente; aún no validado con Entra ID y API Azure reales.

El frontend empaquetado se sirve desde un puerto libre de `localhost`. Sus pantallas en línea envían al proceso principal de Electron únicamente método, ruta relativa, cabeceras permitidas y cuerpo. El proceso principal obtiene el access token de MSAL y llama por HTTPS a la URL de API configurada. Devuelve estado, cabeceras necesarias y contenido, incluidos PDF, Excel y adjuntos. No se expone el token al código de la página ni hace falta habilitar CORS para cada origen local.

El puente acepta solo rutas relativas bajo la API configurada, métodos HTTP previstos y las cabeceras `Content-Type`, `Idempotency-Key` e `If-Match`. Limita el cuerpo JSON a 64 KiB, las cargas binarias a 5 MiB y la respuesta a 12 MiB. Rechaza redirecciones y limita cada llamada a 30 segundos. La política de contenido de la ventana permite conexiones de la página solo a su propio servidor local; la comunicación cloud sale del proceso principal.

La autenticación inicial sigue abriendo el navegador Microsoft mediante MSAL Node. El modo local y su sincronizador siguen usando la base SQLite y las solicitudes firmadas del dispositivo. Este puente permite consultar y gestionar las pantallas en línea desde Electron mientras hay sesión y conexión. **No convierte las funciones administrativas en funciones offline.**

**Verificación:** compilación del frontend, pruebas de transporte JSON y binario, cabeceras, rutas inválidas, límite de cuerpo y respuesta, pruebas del escritorio y paquete Windows. Falta una prueba de extremo a extremo con el tenant real y la API publicada.
