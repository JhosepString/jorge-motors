import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
// MSAL v5: página dedicada sin React, router, telemetría ni consultas a la API.
// No registrar la URL de retorno ni mensajes originales: pueden contener información sensible.
void broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById('estado');
  if (status)
    status.textContent =
      'No se completó la respuesta Microsoft. Vuelve al inicio del sistema e inténtalo de nuevo.';
});
