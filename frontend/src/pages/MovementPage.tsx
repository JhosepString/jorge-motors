import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClient, ApiError, errorText, MovementIntent, stockStatus } from '../core/api';
import type { Movement, Page, Profile, Stock } from '../core/types';
import { Badge, Empty, Loading, Notice, PageHeading, Pager, useLoad } from '../ui/components';
export function MovementPage({ api, profile }: { api: ApiClient; profile: Profile }) {
  const admin = profile.rol === 'ADMINISTRADOR';
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const products = useLoad(
    () =>
      api.json<Page<Stock>>('/inventario/stock?' + new URLSearchParams({ limite: '100', buscar: applied })),
    [api, applied],
  );
  const [productId, setProductId] = useState(params.get('producto') ?? '');
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
  const selected = products.data?.data.find((p) => p.id === Number(productId));
  const units = Number(quantity);
  const validUnits = /^[1-9][0-9]*$/.test(quantity) && units <= 2147483647;
  const finalStock =
    selected && validUnits ? selected.stockActual + (kind === 'entradas' ? units : -units) : undefined;
  const invalid =
    !selected || !validUnits || finalStock === undefined || finalStock < 0 || finalStock > 2147483647;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || invalid) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const body = {
      productoId: Number(productId),
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
          <form
            className="inline-search"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(search);
            }}
          >
            <label>
              Buscar repuesto
              <input
                disabled={busy || uncertain}
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre o SKU"
              />
            </label>
            <button className="secondary" disabled={busy || uncertain}>
              Buscar
            </button>
          </form>
          {products.loading && <Loading />}
          {products.error && <Notice danger>{products.error}</Notice>}
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
              <label>
                Producto
                <select
                  required
                  value={selected ? productId : ''}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">Seleccionar producto</option>
                  {products.data?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.sku} · stock {p.stockActual}
                    </option>
                  ))}
                </select>
              </label>
              {products.data?.siguiente !== null && products.data?.siguiente !== undefined && (
                <small>Hay más de 100 coincidencias. Busca por nombre o SKU para acotar.</small>
              )}
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
  const list = useLoad(
    () => api.json<Page<Movement>>(`/inventario/movimientos?despuesDe=${after}`),
    [api, after],
  );
  return (
    <>
      <PageHeading
        title={profile.rol === 'MECANICO' ? 'Mis movimientos' : 'Movimientos del inventario'}
        subtitle={
          profile.rol === 'MECANICO'
            ? 'El servidor limita esta consulta a los movimientos de tu usuario.'
            : 'Historial inmutable de entradas y salidas, por orden de registro.'
        }
      />
      <section className="panel table-panel">
        <div className="section-heading">
          <h2>Historial de movimientos</h2>
          <button className="text-button" onClick={list.reload}>
            Actualizar
          </button>
        </div>
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
