import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

type Bridge = NonNullable<Window['jorgeDesktop']>;
type LocalStatus = Awaited<ReturnType<Bridge['localStatus']>>;
type LocalProduct = Awaited<ReturnType<Bridge['localInventory']>>[number];
type LocalOperation = Awaited<ReturnType<Bridge['localOperations']>>[number];

export function OfflineWorkspace({ onlineNavigation = false }: { onlineNavigation?: boolean }) {
  const desktop = window.jorgeDesktop!;
  const [status, setStatus] = useState<LocalStatus>();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [operations, setOperations] = useState<LocalOperation[]>([]);
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [type, setType] = useState<'SALIDA' | 'ENTRADA'>('SALIDA');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const matches = query.length < 2 ? [] : products.filter((item) =>
    `${item.sku} ${item.name}`.toLocaleLowerCase().includes(query)).slice(0, 21);
  const selected = products.find((item) => item.id === productId);

  async function refresh() {
    const next = await desktop.localStatus();
    setStatus(next);
    setProducts(next.ready ? await desktop.localInventory() : []);
    setOperations(next.ready ? await desktop.localOperations() : []);
  }
  useEffect(() => {
    void refresh().catch(() => setMessage('No se pudieron leer los datos locales.'));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !status?.ready) return;
    setBusy(true); setMessage('');
    try {
      await desktop.localMove({ productId, type, quantity, reason });
      setReason(''); setMessage('Guardado en este equipo. Pendiente de sincronizar.');
      await refresh();
    } catch { setMessage('No se guardó el movimiento. Revise el cupo; las herramientas requieren préstamo y devolución.'); }
    finally { setBusy(false); }
  }
  async function synchronize() {
    setBusy(true); setMessage('');
    try {
      const result = await desktop.syncNow();
      setMessage(`${result.confirmed} confirmados, ${result.remaining} pendientes.${result.stopped ? ' La conexión requiere atención.' : ''}`);
      await refresh();
    } catch { setMessage('No se pudo sincronizar. Los cambios permanecen guardados en este equipo.'); }
    finally { setBusy(false); }
  }
  if (!status) return <section className="offline-page"><h1>Jorge Motors</h1><p>Cargando datos locales…</p></section>;
  if (!status.ready) return <section className="offline-page"><h1>Acceso local no disponible</h1>
    <p>Se necesita conexión para completar la descarga inicial o revisar el acceso de este equipo.</p>
    <button onClick={() => void desktop.signIn().then(() => window.location.reload())}>Iniciar sesión con Microsoft</button>
    </section>;
  return <section className="offline-page">
    <header><div><span className="eyebrow">JORGE MOTORS · MODO LOCAL · DATOS FICTICIOS</span><h1>Inventario de este equipo</h1>
      <p>{status.profile?.nombres} · {status.pending} operaciones pendientes</p></div>
      <div>{onlineNavigation && <Link to="/inventario">Vista en línea</Link>}
        {!status.online && <button disabled={busy} onClick={() => void desktop.signIn().then(() => window.location.reload())}>
          Conectar con Microsoft</button>}
        {status.online && <button disabled={busy} onClick={() => void synchronize()}>Sincronizar ahora</button>}</div></header>
    <p>El stock total corresponde a la última descarga. Para salidas sin internet se utiliza el cupo asignado a este equipo.</p>
    {operations.some((item) => item.status === 'REJECTED') &&
      <p role="alert">Hay {operations.filter((item) => item.status === 'REJECTED').length} operaciones rechazadas. Conserve este equipo y solicite conciliación al administrador; no las repita como movimientos nuevos.</p>}
    {message && <p role="status">{message}</p>}
    <label>Buscar repuesto por SKU o nombre
      <input value={search} maxLength={100} placeholder="Escribe al menos 2 caracteres"
        disabled={busy} onChange={(event) => { setSearch(event.target.value); setProductId(0); }} />
    </label>
    <p>{products.length} productos guardados en este equipo. {query.length < 2
      ? 'Escribe para buscar sin recorrer toda la lista.' : `Mostrando hasta 20 coincidencias para «${search.trim()}».`}</p>
    <table><thead><tr><th>Producto</th><th>SKU</th><th>Stock descargado</th><th>Cupo disponible aquí</th></tr></thead>
      <tbody>{matches.slice(0, 20).map((item) => <tr key={item.id}>
        <td><button type="button" className="text-button" disabled={busy}
          aria-pressed={productId === item.id} onClick={() => setProductId(item.id)}>{item.name}</button></td>
        <td>{item.sku}</td><td>{item.confirmedStock}</td><td>{item.offlineQuota}</td></tr>)}</tbody></table>
    {query.length >= 2 && !matches.length && <p>No hay productos para esa búsqueda.</p>}
    {matches.length > 20 && <p>Hay más coincidencias. Escribe más del SKU o del nombre.</p>}
    <form onSubmit={(event) => void submit(event)}><h2>Registrar movimiento local</h2>
      <p>Producto seleccionado: <strong>{selected ? `${selected.name} · ${selected.sku}` : 'ninguno'}</strong></p>
      {status.profile?.rol === 'ADMINISTRADOR' && <label>Tipo<select value={type}
        onChange={(event) => setType(event.target.value as 'SALIDA' | 'ENTRADA')}>
        <option value="SALIDA">Salida</option><option value="ENTRADA">Entrada pendiente</option></select></label>}
      <label>Cantidad<input type="number" min="1" max="2147483647" required value={quantity}
        onChange={(event) => setQuantity(Number(event.target.value))} /></label>
      <label>Motivo<input maxLength={300} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {selected && /^SIM-(HMA|HMO|DIA|ELEVA|TAL)-/.test(selected.sku) && type === 'SALIDA' &&
        <p role="alert">Esta herramienta requiere préstamo y devolución. La salida común está bloqueada.</p>}
      <button disabled={busy || !productId || (type === 'SALIDA' && !!selected && /^SIM-(HMA|HMO|DIA|ELEVA|TAL)-/.test(selected.sku))}>{busy ? 'Guardando…' : 'Guardar en este equipo'}</button>
    </form>
    <section><h2>Operaciones por sincronizar o revisar</h2>
      {!operations.length && <p>No hay operaciones pendientes ni rechazadas.</p>}
      <ul>{operations.map((item) => <li key={item.operationId}>
        <strong>{item.status === 'REJECTED' ? 'Rechazada' : 'Pendiente'}</strong> · {item.type === 'SALIDA' ? 'Salida' : 'Entrada'} de {item.quantity} · {item.name} ({item.sku})
        {item.error && <> · Motivo técnico: {item.error}</>}
      </li>)}</ul>
    </section>
  </section>;
}
