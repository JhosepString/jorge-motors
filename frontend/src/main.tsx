import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { createSession } from './core/session';
import { ApiClient } from './core/api';
import { Application } from './Application';
const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const session = await createSession(import.meta.env);
    const api = new ApiClient(import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1', () =>
      session.token(),
    );
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <Application session={session} api={api} />
        </BrowserRouter>
      </React.StrictMode>,
    );
  } catch {
    root.render(
      <main className="startup">
        <h1>Jorge Motors</h1>
        <p role="alert">
          No se pudo preparar el acceso. Revise la configuración pública del frontend y el retorno SPA. No
          comparta contraseñas ni tokens.
        </p>
        <button onClick={() => window.location.reload()}>Volver a intentar</button>
      </main>,
    );
  }
}
void start();
