// Entrada exclusiva de pruebas, NO importada por index.html ni incluida por vite build.
// API ficticia en el servidor de pruebas; Playwright intercepta todas las solicitudes.
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Application } from '../src/Application';
import { ApiClient } from '../src/core/api';
import type { Session } from '../src/core/session';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '../src/styles.css';
if (!import.meta.env.DEV)
  throw new Error('Entrada de pruebas deshabilitada fuera del servidor de desarrollo.');
const session: Session = {
  configured: true,
  hasAccount: () => true,
  token: async () => 'FICTICIO_NO_ES_TOKEN_VALIDO',
  signIn: async () => {},
  signOut: async () => {
    window.location.assign('/');
  },
};
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Application
      session={session}
      api={new ApiClient(`${window.location.origin}/api/v1`, () => session.token())}
    />
  </BrowserRouter>,
);
