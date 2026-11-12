import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClient, ApiError, errorText, MovementIntent, stockStatus } from '../core/api';
import type { Movement, Page, Profile, Stock } from '../core/types';
import { Badge, Empty, Loading, Notice, PageHeading, Pager, useLoad } from '../ui/components';
export function MovementPage({ api, profile }: { api: ApiClient; profile: Profile }) {
  const admin = profile.rol === 'ADMINISTRADOR';
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('sku') ?? '');
  const [applied, setApplied] = useState(params.get('sku') ?? '');
  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const products = useLoad(
    () => applied.length < 2
      ? Promise.resolve({ data: [], siguiente: null } as Page<Stock>)
      : api.json<Page<Stock>>('/inventario/stock?' + new URLSearchParams({ limite: '20', buscar: applied })),
    [api, applied],
  );
  const [selected, setSelected] = useState<Stock | null>(null);
  const [kind, setKind] = useState<'entradas' | 'salidas'>('salidas');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const intent = useRef(new MovementIntent());
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ data: Movement; repetido: boolean }>();
  const [uncertain, setUncertain] = useState(false);
  const showingResults = search.trim().length >= 2 && applied === search.trim();
  const units = Number(quantity);
  const validUnits = /^[1-9][0-9]*$/.test(quantity) && units <= 2147483647;
  const finalStock =
    selected && validUnits ? selected.stockActual + (kind === 'entradas' ? units : -units) : undefined;
  const invalid =
    !selected || (kind === 'salidas' && selected.tipo === 'HERRAMIENTA') || !validUnits || finalStock === undefined || finalStock < 0 || finalStock > 2147483647;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || invalid) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const body = {
      productoId: selected!.id,
      cantidad: units,
      motivo: reason.trim(),
      ...(reference.trim() ? { referencia: reference.trim() } : {}),
    };
    const key = intent.current.forPayload({ kind, ...body });
    try {
      const response = await api.json<{ data: Movement; repetido: boolean }>(`/inventario/${kind}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      setResult(response);
      setUncertain(false);
      intent.current.reset();
      products.reload();
    } catch (e) {
      setError(errorText(e));
      // Un 4xx es rechazo conocido. Red/5xx conservan la intención bloqueada para reintentar.
      const rejected = e instanceof ApiError && e.status >= 400 && e.status < 500;
      setUncertain(!rejected);
      if (rejected) products.reload();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (result)
    return (
      <>
        <PageHeading
          title="Movimiento registrado"
          subtitle="El servidor confirmó la operación y su trazabilidad."
        />
        <section className="panel confirmation">
          <span className="success-icon" aria-hidden="true">
            ✓
          </span>
          <h2>Movimiento guardado</h2>
          <p>
            {result.data.tipo === 'SALIDA' ? 'Salida' : 'Entrada'} de {result.data.cantidad} unidades ·
            Movimiento #{result.data.id}
          </p>
          {result.repetido && (
            <Notice>Se recuperó la operación original. No se modificó el stock otra vez.</Notice>
          )}
          <div className="confirmation-data">
            <div>
              <span>Referencia</span>
              <strong>{result.data.referencia ?? 'Sin referencia'}</strong>
            </div>
            <div>
              <span>Stock anterior</span>
              <strong>{result.data.stockAnterior}</strong>
            </div>
            <div>
              <span>Stock resultante</span>
              <strong>{result.data.stockResultante}</strong>
            </div>
          </div>
          <div className="actions">
            <Link to="/historial" className="secondary">
              Ver movimientos
            </Link>
            <button
              className="primary"
              onClick={() => {
                setResult(undefined);
                setReason('');
                setReference('');
                setQuantity('1');
                setSelected(null);
              }}
            >
              Registrar otro movimiento
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <PageHeading
        title={admin ? 'Registrar movimiento' : 'Registrar salida'}
        subtitle="Selecciona el producto y revisa el impacto antes de confirmar."
      />
      <div className="two-columns">
        <section className="panel form-panel">
          <h2>{admin ? 'Nuevo movimiento' : 'Datos de la salida'}</h2>
          <p>El sistema valida que haya suficientes unidades.</p>
          <div className="inline-search">
            <label>
              Buscar repuesto por SKU o nombre
              <input
                disabled={busy || uncertain}
                value={search}
                maxLength={100}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                placeholder="Escribe al menos 2 caracteres"
                autoComplete="off"
              />
            </label>
          </div>
          {search.trim().length < 2 && <p>Escribe el código o parte del nombre para encontrar un producto.</p>}
          {showingResults && products.loading && <Loading />}
          {showingResults && products.error && <Notice danger>{products.error}</Notice>}
          {showingResults && !products.loading && !products.error && (
            <div className="product-results" aria-label="Productos encontrados">
              {products.data?.data.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`product-result${selected?.id === p.id ? ' is-selected' : ''}`}
                  aria-pressed={selected?.id === p.id}
                  disabled={busy || uncertain || (kind === 'salidas' && p.tipo === 'HERRAMIENTA')}
                  onClick={() => setSelected(p)}
                >
                  <span><strong>{p.nombre}</strong><small className="sku">{p.sku}{p.tipo === 'HERRAMIENTA' ? ' · Requiere préstamo' : ''}</small></span>
                  <span className="quantity">{p.stockActual} unidades</span>
                </button>
              ))}
              {!products.data?.data.length && <p>No hay productos para esa búsqueda.</p>}
              {products.data?.siguiente != null && <small>Hay más resultados. Escribe más del SKU o del nombre.</small>}
            </div>
          )}
          <form className="stack" onSubmit={(e) => void submit(e)}>
            <fieldset disabled={busy || uncertain}>
              {admin && (
                <label>
                  Tipo de movimiento
                  <select value={kind} onChange={(e) => setKind(e.target.value as 'entradas' | 'salidas')}>
                    <option value="salidas">↑ Salida</option>
                    <option value="entradas">↓ Entrada</option>
                  </select>
                </label>
              )}
              <p className="selected-product">
                {selected ? <>Producto seleccionado: <strong>{selected.nombre}</strong> · {selected.sku}</> : 'Selecciona un producto de los resultados.'}
              </p>
              {selected?.tipo === 'HERRAMIENTA' && kind === 'salidas' &&
                <Notice danger>Las herramientas no pueden salir como consumo. Requieren préstamo y devolución.</Notice>}
              <div className="field-row">
                <label>
                  Cantidad
                  <input
                    type="number"
                    min={1}
                    step={1}
                    max={2147483647}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label>
                  Referencia de trabajo (opcional)
                  <input
                    maxLength={100}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="OT-2026-1042"
                  />
                </label>
              </div>
              <label>
                Motivo
                <input
                  required
                  minLength={3}
                  maxLength={250}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Uso de repuesto en mantenimiento"
                />
              </label>
            </fieldset>
            {error && <Notice danger>{error}</Notice>}
            {uncertain && (
              <Notice>
                La respuesta no se confirmó. Reintenta sin cambiar los datos: se conserva la misma clave para
                evitar duplicados. No recargues ni abandones esta pantalla hasta comprobar el resultado.
              </Notice>
            )}
            <button className="primary align-end" disabled={busy || invalid}>
              {busy
                ? 'Confirmando…'
                : uncertain
                  ? 'Reintentar la misma operación'
                  : kind === 'entradas'
                    ? 'Confirmar entrada →'
                    : 'Confirmar salida →'}
            </button>
          </form>
        </section>
        <div className="stack">
          <aside className="panel impact">
            <h2>Impacto en el inventario</h2>
            <dl>
              <div>
                <dt>Stock consultado</dt>
                <dd>{selected ? `${selected.stockActual} unidades` : '—'}</dd>
              </div>
              <div>
                <dt>Movimiento</dt>
                <dd className={kind === 'entradas' ? 'positive' : 'negative'}>
                  {validUnits ? `${kind === 'entradas' ? '+' : '−'} ${units}` : '—'}
                </dd>
              </div>
              <div>
                <dt>Stock previsto</dt>
                <dd>{finalStock === undefined ? '—' : finalStock}</dd>
              </div>
            </dl>
            {selected && finalStock !== undefined && (
              <Badge
                state={finalStock < 0 ? 'AGOTADO' : stockStatus({ ...selected, stockActual: finalStock })}
              />
            )}
            <p>
              Vista previa orientativa. Otra operación puede cambiar el saldo; prevalece la validación del
              servidor.
            </p>
          </aside>
          <aside className="panel rules">
            <h2>Reglas automáticas</h2>
            <ul>
              <li>Una salida no puede superar el stock.</li>
              <li>Todo cambio queda asociado a tu usuario.</li>
              <li>El mínimo es inclusivo: llegar al mínimo también requiere reposición.</li>
              <li>Una compra con factura debe recibirse desde Compras para conservar el vínculo.</li>
            </ul>
          </aside>
        </div>
      </div>
    </>
  );
}
export function HistoryPage({ api, profile }: { api: ApiClient; profile: Profile }) {
  const [after, setAfter] = useState(0);
  const [fromDraft, setFromDraft] = useState('');
  const [untilDraft, setUntilDraft] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const invalidRange = !!fromDraft && !!untilDraft && fromDraft > untilDraft;
  const list = useLoad(
    () => {
      const query = new URLSearchParams({ despuesDe: String(after) });
      if (from) query.set('fechaDesde', new Date(`${from}T00:00:00`).toISOString());
      if (until) {
        const nextDay = new Date(`${until}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        query.set('fechaHasta', nextDay.toISOString());
      }
      return api.json<Page<Movement>>(`/inventario/movimientos?${query}`);
    },
    [api, after, from, until],
  );
  return (
    <>
      <PageHeading
        title={profile.rol === 'MECANICO' ? 'Mis movimientos' : 'Movimientos del inventario'}
        subtitle={
          profile.rol === 'MECANICO'
            ? 'El servidor limita esta consulta a los movimientos de tu usuario.'
            : 'Historial inmutable de entradas y salidas, del más reciente al más antiguo.'
        }
      />
      <section className="panel table-panel">
        <div className="section-heading">
          <h2>Historial de movimientos</h2>
          <button className="text-button" onClick={list.reload}>
            Actualizar
          </button>
        </div>
        <form className="filters" onSubmit={(event) => {
          event.preventDefault();
          if (invalidRange) return;
          setAfter(0);
          setFrom(fromDraft);
          setUntil(untilDraft);
          if (from === fromDraft && until === untilDraft) list.reload();
        }}>
          <label>Desde
            <input type="date" value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} />
          </label>
          <label>Hasta
            <input type="date" value={untilDraft} onChange={(event) => setUntilDraft(event.target.value)} />
          </label>
          <button className="secondary" disabled={invalidRange}>Aplicar fechas</button>
          <button type="button" className="text-button" disabled={!fromDraft && !untilDraft && !from && !until}
            onClick={() => { setFromDraft(''); setUntilDraft(''); setFrom(''); setUntil(''); setAfter(0); }}>
            Limpiar fechas
          </button>
        </form>
        {invalidRange && <Notice danger>La fecha «Desde» no puede ser posterior a «Hasta».</Notice>}
        {list.loading && <Loading />}
        {list.error && <Notice danger>{list.error}</Notice>}
        {list.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th>Referencia</th>
                    <th>Cantidad</th>
                    <th>Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.fecha).toLocaleString('es-PE')}</td>
                      <td>
                        <strong>{m.nombre}</strong>
                        <small className="sku">
                          {m.sku} · #{m.id}
                        </small>
                      </td>
                      <td>{m.tipo === 'SALIDA' ? 'Salida' : 'Entrada'}</td>
                      <td>
                        {m.referencia ?? '—'}
                        <small>{m.motivo}</small>
                      </td>
                      <td className={`mono ${m.tipo === 'SALIDA' ? 'negative' : 'positive'}`}>
                        {m.tipo === 'SALIDA' ? '−' : '+'} {m.cantidad}
                      </td>
                      <td className="quantity">{m.stockResultante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.data.data.length && <Empty />}
            <Pager after={after} next={list.data.siguiente} onNext={setAfter} reset={() => setAfter(0)} />
          </>
        )}
      </section>
    </>
  );
}
