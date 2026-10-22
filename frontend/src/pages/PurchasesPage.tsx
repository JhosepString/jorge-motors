import { useRef, useState, type FormEvent } from 'react';
import { ApiClient, errorText, pen } from '../core/api';
import type { Page, Stock, Supplier } from '../core/types';
import { Badge, Empty, Loading, Modal, Notice, PageHeading, Pager, useLoad } from '../ui/components';
interface InvoiceLine {
  productoId: number;
  sku: string;
  nombre: string;
  cantidad: number;
  precioUnitario: string;
  importe: string;
  movimientoId: number | null;
}
interface Invoice {
  id: number;
  numero: string;
  proveedorId: number;
  proveedorNombre: string;
  fecha: string;
  moneda: 'PEN';
  total: string;
  estado: 'BORRADOR' | 'RECIBIDA' | 'ANULADA';
  version: string;
  lineas: InvoiceLine[];
}
interface Attachment {
  id: string;
  nombre: string;
  estado: 'PENDIENTE' | 'LISTO' | 'ELIMINADO';
  bytes: number;
  contentType: string;
}
export function PurchasesPage({ api }: { api: ApiClient }) {
  const [after, setAfter] = useState(0);
  const [selected, setSelected] = useState<number | 'nuevo'>();
  const list = useLoad(() => api.json<Page<Invoice>>(`/compras/facturas?despuesDe=${after}`), [api, after]);
  return (
    <>
      <PageHeading
        title="Facturas de compra"
        subtitle="Registra el sustento y recibe todos los productos en una sola operación."
      >
        <button className="primary" onClick={() => setSelected('nuevo')}>
          + Nueva factura
        </button>
      </PageHeading>
      <section className="panel table-panel">
        {list.loading && <Loading />}
        {list.error && <Notice danger>{list.error}</Notice>}
        {list.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Proveedor</th>
                    <th>Fecha</th>
                    <th>Total PEN</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <strong>{f.numero}</strong>
                        <small>#{f.id}</small>
                      </td>
                      <td>{f.proveedorNombre}</td>
                      <td>{f.fecha}</td>
                      <td className="mono">{pen(f.total)}</td>
                      <td>
                        <Badge state={f.estado} />
                      </td>
                      <td>
                        <button className="text-button" onClick={() => setSelected(f.id)}>
                          Abrir →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.data.data.length && <Empty>No hay facturas registradas.</Empty>}
            <Pager after={after} next={list.data.siguiente} onNext={setAfter} reset={() => setAfter(0)} />
          </>
        )}
      </section>
      <Notice>
        No es emisión ni validación tributaria. Crear un borrador no cambia stock; confirmar su recepción sí
        registra entradas y conserva el vínculo por línea.
      </Notice>
      {selected !== undefined && (
        <Modal
          title={selected === 'nuevo' ? 'Nueva factura de compra' : 'Detalle de factura'}
          close={() => setSelected(undefined)}
        >
          {selected === 'nuevo' ? (
            <InvoiceForm
              api={api}
              saved={(id) => {
                setSelected(id);
                list.reload();
              }}
            />
          ) : (
            <InvoiceDetail key={selected} api={api} id={selected} changed={list.reload} />
          )}
        </Modal>
      )}
    </>
  );
}
function InvoiceForm({ api, saved }: { api: ApiClient; saved: (id: number) => void }) {
  const suppliers = useLoad(() => api.json<Page<Supplier>>('/compras/proveedores?limite=100'), [api]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const products = useLoad(
    () =>
      api.json<Page<Stock>>('/inventario/stock?' + new URLSearchParams({ limite: '100', buscar: applied })),
    [api, applied],
  );
  const [lines, setLines] = useState([{ productoId: '', cantidad: '1', precioUnitario: '0.00' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api.json<{ data: Invoice }>('/compras/facturas', {
        method: 'POST',
        body: JSON.stringify({
          proveedorId: Number(f.get('proveedor')),
          numero: String(f.get('numero')).trim().toUpperCase(),
          fecha: String(f.get('fecha')),
          moneda: 'PEN',
          lineas: lines.map((l) => ({
            productoId: Number(l.productoId),
            cantidad: Number(l.cantidad),
            precioUnitario: l.precioUnitario,
          })),
        }),
      });
      saved(result.data.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="inline-search">
        <label>
          Buscar productos para las líneas
          <input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        </label>
        <button className="secondary" onClick={() => setApplied(search)}>
          Buscar
        </button>
      </div>
      {suppliers.error && <Notice danger>{suppliers.error}</Notice>}
      {products.error && <Notice danger>{products.error}</Notice>}
      {suppliers.data?.siguiente !== null && suppliers.data?.siguiente !== undefined && (
        <Notice>
          Se muestran los primeros 100 proveedores. Para otros proveedores usa el cliente CLI hasta incorporar
          selección paginada.
        </Notice>
      )}
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <label>
            Proveedor
            <select required name="proveedor">
              <option value="">Seleccionar proveedor activo</option>
              {suppliers.data?.data
                .filter((p) => p.activo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.razonSocial} · {p.codigo}
                  </option>
                ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              Número de documento
              <input
                name="numero"
                required
                maxLength={40}
                pattern="[A-Za-z0-9][A-Za-z0-9/\-]*"
                placeholder="F001-000123"
              />
            </label>
            <label>
              Fecha
              <input name="fecha" type="date" required />
            </label>
          </div>
          <h3>Líneas del documento</h3>
          {lines.map((line, i) => (
            <div className="invoice-line" key={i}>
              <label>
                Producto
                <select
                  required
                  value={line.productoId}
                  onChange={(e) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, productoId: e.target.value } : l)))
                  }
                >
                  <option value="">Seleccionar producto</option>
                  {line.productoId && !products.data?.data.some((p) => String(p.id) === line.productoId) && (
                    <option value={line.productoId}>Producto seleccionado #{line.productoId}</option>
                  )}
                  {products.data?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.sku}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cantidad
                <input
                  required
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  value={line.cantidad}
                  onChange={(e) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, cantidad: e.target.value } : l)))
                  }
                />
              </label>
              <label>
                Precio final PEN
                <input
                  required
                  pattern="(0|[1-9][0-9]{0,15})\.[0-9]{2}"
                  inputMode="decimal"
                  value={line.precioUnitario}
                  onChange={(e) =>
                    setLines(lines.map((l, j) => (j === i ? { ...l, precioUnitario: e.target.value } : l)))
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
                aria-label={`Quitar línea ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={lines.length >= 50}
            onClick={() => setLines([...lines, { productoId: '', cantidad: '1', precioUnitario: '0.00' }])}
          >
            + Añadir línea
          </button>
        </fieldset>
        <Notice>
          Precios finales de dos decimales; no se calcula IGV. El servidor valida importes, duplicados y el
          total exacto. Guarda como borrador antes de recibir.
        </Notice>
        {error && <Notice danger>{error}</Notice>}
        <button className="primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar borrador'}
        </button>
      </form>
    </>
  );
}
function InvoiceDetail({ api, id, changed }: { api: ApiClient; id: number; changed: () => void }) {
  const detail = useLoad(() => api.json<{ data: Invoice }>(`/compras/facturas/${id}`), [api, id]);
  if (detail.loading) return <Loading />;
  if (detail.error) return <Notice danger>{detail.error}</Notice>;
  if (!detail.data) return null;
  return (
    <InvoiceActions
      key={detail.data.data.version}
      api={api}
      invoice={detail.data.data}
      refreshed={() => {
        detail.reload();
        changed();
      }}
    />
  );
}
function InvoiceActions({
  api,
  invoice,
  refreshed,
}: {
  api: ApiClient;
  invoice: Invoice;
  refreshed: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useRef(crypto.randomUUID());
  const [error, setError] = useState('');
  async function action(kind: 'confirmar' | 'anular') {
    if (!confirmed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await api.json(`/compras/facturas/${invoice.id}/${kind}`, {
        method: 'POST',
        body: '{}',
        headers: {
          'If-Match': `"${invoice.version}"`,
          ...(kind === 'confirmar' ? { 'Idempotency-Key': key.current } : {}),
        },
      });
      refreshed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="section-heading">
        <div>
          <h2>{invoice.numero}</h2>
          <p>
            {invoice.proveedorNombre} · {invoice.fecha}
          </p>
        </div>
        <Badge state={invoice.estado} />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineas.map((l) => (
              <tr key={l.productoId}>
                <td>
                  <strong>{l.nombre}</strong>
                  <small className="sku">{l.sku}</small>
                </td>
                <td>{l.cantidad}</td>
                <td className="mono">{pen(l.precioUnitario)}</td>
                <td className="mono">{pen(l.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="invoice-total">
        Total PEN <strong>{pen(invoice.total)}</strong>
      </p>
      {invoice.estado === 'BORRADOR' && (
        <>
          <Notice>
            Recibir confirma todas las líneas y aumenta stock. Anular solo invalida este borrador, sin
            modificar existencias. Una factura recibida es inmutable.
          </Notice>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />
            He revisado el documento y el efecto de la acción que seleccionaré.
          </label>
          <div className="actions">
            <button className="secondary" disabled={!confirmed || busy} onClick={() => void action('anular')}>
              Anular borrador
            </button>
            <button
              className="primary"
              disabled={!confirmed || busy}
              onClick={() => void action('confirmar')}
            >
              {busy ? 'Procesando…' : 'Confirmar recepción completa'}
            </button>
          </div>
          {error && (
            <Notice danger>
              {error} Si la respuesta es incierta, reintenta aquí con la misma versión y clave, sin recargar.
            </Notice>
          )}
          <small>
            La edición de líneas/fecha del borrador sigue disponible por CLI/API; esta primera interfaz
            permite crear, revisar, recibir y anular.
          </small>
        </>
      )}
      <Attachments api={api} invoiceId={invoice.id} cancelled={invoice.estado === 'ANULADA'} />
    </div>
  );
}
function Attachments({
  api,
  invoiceId,
  cancelled,
}: {
  api: ApiClient;
  invoiceId: number;
  cancelled: boolean;
}) {
  const list = useLoad(
    () => api.json<{ data: Attachment[] }>(`/compras/facturas/${invoiceId}/adjuntos`),
    [api, invoiceId],
  );
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      if (
        !file.size ||
        file.size > 5 * 1024 * 1024 ||
        !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
      )
        throw new Error('Archivo inválido.');
      await api.json(
        `/compras/facturas/${invoiceId}/adjuntos?${new URLSearchParams({ nombre: file.name })}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'Idempotency-Key': key.current },
          body: file,
        },
      );
      setFile(undefined);
      key.current = crypto.randomUUID();
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(item: Attachment) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.response(`/compras/facturas/${invoiceId}/adjuntos/${item.id}/contenido`);
      const blob = await response.blob();
      if (blob.size > 5 * 1024 * 1024) throw new Error('Archivo excesivo.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-adjunto-${item.id}.${item.contentType === 'application/pdf' ? 'pdf' : item.contentType === 'image/png' ? 'png' : 'jpg'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attachment-section">
      <h3>Documentos privados</h3>
      <p>
        PDF, PNG o JPEG · máximo 5 MiB · hasta cinco documentos. Validación básica, sin antivirus todavía.
      </p>
      {list.loading && <Loading />}
      {list.error && <Notice danger>{list.error}</Notice>}
      {list.data?.data.map((a) => (
        <div className="attachment-row" key={a.id}>
          <span>
            {a.nombre}
            <small>
              {Math.ceil(a.bytes / 1024)} KB · {a.estado}
            </small>
          </span>
          <button
            className="text-button"
            disabled={busy || a.estado !== 'LISTO'}
            onClick={() => void download(a)}
          >
            Descargar
          </button>
        </div>
      ))}
      {!cancelled && (
        <div className="stack">
          <label>
            Seleccionar documento
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                key.current = crypto.randomUUID();
              }}
            />
          </label>
          <button className="secondary" disabled={!file || busy} onClick={() => void upload()}>
            {busy ? 'Procesando…' : 'Adjuntar documento'}
          </button>
        </div>
      )}
      {error && <Notice danger>{error}</Notice>}
    </section>
  );
}
