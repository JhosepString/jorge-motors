import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from './core/session';
import { ApiClient, errorText } from './core/api';
import type { Profile } from './core/types';
import { Notice, Loading } from './ui/components';
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const MovementPage = lazy(() => import('./pages/MovementPage').then((m) => ({ default: m.MovementPage })));
const HistoryPage = lazy(() => import('./pages/MovementPage').then((m) => ({ default: m.HistoryPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const OverviewPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.OverviewPage })));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage').then((m) => ({ default: m.PurchasesPage })));

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">JM</span>
      <span>
        JORGE<small>MOTORS</small>
      </span>
    </div>
  );
}
export function Application({ session, api }: { session: Session; api: ApiClient }) {
  const [profile, setProfile] = useState<Profile>();
  const [loading, setLoading] = useState(session.hasAccount());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const changed = () => setMobile(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    let active = true;
    if (session.hasAccount())
      void api
        .json<{ data: Profile }>('/auth/me')
        .then(({ data }) => {
          if (!['ADMINISTRADOR', 'MECANICO'].includes(data.rol)) throw new Error('Perfil inválido.');
          if (active) setProfile(data);
        })
        .catch((e: unknown) => {
          if (active) setError(errorText(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [api, session]);
  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await session.signIn();
    } catch {
      setError('No se pudo iniciar el acceso Microsoft. Revise el registro SPA y el retorno.');
      setBusy(false);
    }
  }
  async function signOut() {
    setProfile(undefined);
    setBusy(true);
    try {
      await session.signOut();
    } catch {
      setError(
        'No se completó el cierre Microsoft. Cierre las pestañas del sistema si usa un equipo compartido.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <div className="login-page">
        <section className="login-story">
          <Brand />
          <h1>
            Control total del inventario,
            <br />
            sin frenar el trabajo.
          </h1>
          <p>Consulta existencias, registra movimientos y anticipa faltantes desde un solo lugar.</p>
          <div className="story-note">
            <span>TRAZABILIDAD EN CADA OPERACIÓN</span>
            <h2>
              Cada movimiento actualiza el saldo
              <br />y deja un historial verificable.
            </h2>
          </div>
        </section>
        <main className="login-form">
          <div>
            <span className="eyebrow">INVENTARIO TÉCNICO · JORGE MOTORS</span>
            <h2>Bienvenido de nuevo</h2>
            <p>Ingresa con tu identidad de trabajo para continuar.</p>
            {loading ? (
              <Loading />
            ) : (
              <>
                <div className="identity-card">
                  <span className="identity-symbol" aria-hidden="true">
                    ▦
                  </span>
                  <div>
                    <strong>Microsoft Entra ID</strong>
                    <p>
                      Tu cuenta, tus permisos.
                      <br />
                      Nosotros no guardamos tu contraseña.
                    </p>
                  </div>
                </div>
                {error && <Notice danger>{error}</Notice>}
                {!session.configured && (
                  <Notice>
                    Falta configurar el registro SPA en Entra y el archivo público de entorno del frontend.
                    Consulta la guía de la Parte 6; Azure lo configura el responsable manualmente.
                  </Notice>
                )}
                <button
                  className="primary login-button"
                  disabled={!session.configured || busy}
                  onClick={() => void signIn()}
                >
                  {busy ? 'Abriendo Microsoft…' : 'Continuar con Microsoft  →'}
                </button>
                <p className="login-security">
                  Acceso seguro · Autorización por rol · Sin contraseñas locales
                </p>
              </>
            )}
          </div>
          <small>© Jorge Motors · Demostración académica</small>
        </main>
      </div>
    );
  const admin = profile.rol === 'ADMINISTRADOR';
  const name = profile.nombres;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  const links = admin
    ? [
        ['/', '▦', 'Resumen'],
        ['/inventario', '◫', 'Inventario'],
        ['/movimiento', '↗', 'Registrar movimiento'],
        ['/historial', '▤', 'Movimientos'],
        ['/reportes', '▤', 'Reportes'],
        ['/proveedores', '⌕', 'Proveedores'],
        ['/compras', '▤', 'Compras'],
      ]
    : [
        ['/inventario', '⌕', 'Consultar stock'],
        ['/movimiento', '↗', 'Registrar salida'],
        ['/historial', '▤', 'Mis movimientos'],
      ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      {mobile && menu && (
        <button className="mobile-shade" aria-label="Cerrar navegación" onClick={() => setMenu(false)} />
      )}
      <aside
        id="navegacion"
        className={`sidebar ${menu ? 'open' : ''}`}
        inert={mobile && !menu}
        aria-hidden={mobile && !menu}
      >
        <Brand />
        <p className="nav-label">{admin ? 'OPERACIONES' : 'MECÁNICO'}</p>
        <nav aria-label="Navegación principal">
          {links.map(([to, icon, label]) => (
            <NavLink to={to!} end={to === '/'} key={to} onClick={() => setMenu(false)}>
              <span aria-hidden="true">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-profile">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{name}</strong>
            <small>{admin ? 'Administrador' : 'Mecánico'}</small>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="menu-toggle text-button"
            aria-label="Abrir navegación"
            aria-controls="navegacion"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <span>
            JORGE MOTORS <b>/</b> INVENTARIO TÉCNICO
          </span>
          <div>
            <span className="environment">DEMO LOCAL</span>
            <span className="avatar dark" title={name}>
              {initials}
            </span>
            <button className="text-button" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
        </header>
        <main id="contenido" className="content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route
                path="/"
                element={admin ? <OverviewPage api={api} /> : <Navigate to="/inventario" replace />}
              />
              <Route path="/inventario" element={<InventoryPage api={api} profile={profile} />} />
              <Route path="/movimiento" element={<MovementPage api={api} profile={profile} />} />
              <Route path="/historial" element={<HistoryPage api={api} profile={profile} />} />
              <Route
                path="/reportes"
                element={
                  admin ? (
                    <ReportsPage api={api} />
                  ) : (
                    <Notice danger>Tu rol no permite consultar reportes.</Notice>
                  )
                }
              />
              <Route
                path="/proveedores"
                element={
                  admin ? (
                    <SuppliersPage api={api} />
                  ) : (
                    <Notice danger>Tu rol no permite gestionar proveedores.</Notice>
                  )
                }
              />
              <Route
                path="/compras"
                element={
                  admin ? (
                    <PurchasesPage api={api} />
                  ) : (
                    <Notice danger>Tu rol no permite gestionar compras.</Notice>
                  )
                }
              />
              <Route
                path="*"
                element={
                  <>
                    <h1>Página no encontrada</h1>
                    <Link to="/">Volver al inicio</Link>
                  </>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer className="app-footer">
          Jorge Motors · Inventario técnico <span>Información protegida por rol</span>
        </footer>
      </div>
    </div>
  );
}
