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
import { OfflineWorkspace } from './OfflineWorkspace';
import { desktopTransport } from './core/desktop-transport';
const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const session = await createSession(import.meta.env);
    const desktop = window.jorgeDesktop ? await window.jorgeDesktop.state() : null;
    const apiBaseUrl = desktop?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';
    const api = new ApiClient(apiBaseUrl, () => session.token(),
      window.jorgeDesktop && desktop?.apiBaseUrl ? desktopTransport(apiBaseUrl, window.jorgeDesktop) : fetch);
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          {desktop?.offlineAuthorized && !desktop.signedIn
            ? <OfflineWorkspace /> : <Application session={session} api={api} />}
        </BrowserRouter>
      </React.StrictMode>,
    );
  } catch {
    root.render(
      <main className="startup">
        <h1>Jorge Motors</h1>
        <p role="alert">
          {window.jorgeDesktop
            ? 'No se pudo preparar el acceso local. Cierre y vuelva a abrir Jorge Motors.'
            : 'No se pudo preparar el acceso. Revise la configuración pública del frontend y el retorno SPA.'}
        </p>
        <button onClick={() => window.location.reload()}>Volver a intentar</button>
      </main>,
    );
  }
}
void start();
