import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, errorText, pen } from '../core/api';
import type { InventoryReport, Movement, Page } from '../core/types';
import { Badge, Empty, Loading, Notice, PageHeading, useLoad } from '../ui/components';
import { categories } from './InventoryPage';
export function ReportsPage({ api }: { api: ApiClient }) {
  const [filter, setFilter] = useState({
    categoriaId: '',
    incluirInactivos: 'false',
    soloBajoMinimo: 'false',
  });
  const cats = useLoad(() => categories(api), [api]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState(false);
  const query = new URLSearchParams(filter);
  if (!filter.categoriaId) query.delete('categoriaId');
  const report = useLoad(() => api.json<InventoryReport>('/reportes/inventario?' + query), [api, filter]);
  async function download(format: 'pdf' | 'xlsx') {
    if (busy) return;
    setBusy(format);
    setMessage('');
    setFailure(false);
    try {
      const params = new URLSearchParams(query);
      params.set('formato', format);
      const response = await api.response('/reportes/inventario/exportar?' + params);
      const mime =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (response.headers.get('content-type') !== mime) throw new Error('Formato de respuesta no esperado.');
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Archivo incompatible.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventario.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage('Archivo generado. Revisa las descargas del navegador.');
    } catch (e) {
      setFailure(true);
      setMessage(errorText(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeading
        title="Reportes"
        subtitle="Consulta del inventario actual, con precios de compra en soles."
      >
        <div className="actions">
          <button className="secondary" disabled={!!busy} onClick={() => void download('pdf')}>
            {busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}
          </button>
          <button className="primary" disabled={!!busy} onClick={() => void download('xlsx')}>
            {busy === 'xlsx' ? 'Generando…' : 'Descargar Excel'}
          </button>
        </div>
      </PageHeading>
      <div className="tabs">
        <span className="selected">Inventario</span>
        <span>Kardex exportable · pendiente</span>
      </div>
      <div className="filters">
        <label>
          Categoría
          <select
            value={filter.categoriaId}
            onChange={(e) => setFilter({ ...filter, categoriaId: e.target.value })}
          >
            <option value="">Todas</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Productos
          <select
            value={filter.incluirInactivos}
            onChange={(e) => setFilter({ ...filter, incluirInactivos: e.target.value })}
          >
            <option value="false">Solo activos</option>
            <option value="true">Activos e inactivos</option>
          </select>
        </label>
        <label>
          Existencias
          <select
            value={filter.soloBajoMinimo}
            onChange={(e) => setFilter({ ...filter, soloBajoMinimo: e.target.value })}
          >
            <option value="false">Todas</option>
            <option value="true">Bajo mínimo (incluye agotados)</option>
          </select>
        </label>
      </div>
      {message && <Notice danger={failure}>{message}</Notice>}
      {cats.error && <Notice danger>{cats.error}</Notice>}
      {report.error && <Notice danger>{report.error}</Notice>}
      {report.loading && <Loading />}
      {report.data && (
        <>
          <div className="metric-strip panel">
            {[
              ['Productos', report.data.resumen.productos],
              ['Agotados', report.data.resumen.agotados],
              ['Bajo mínimo', report.data.resumen.bajoMinimo],
              ['Inactivos', report.data.resumen.inactivos],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="panel table-panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Stock</th>
                    <th>Mínimo</th>
                    <th>Precio compra PEN</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.data.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <small className="sku">{p.sku}</small>
                        <strong>{p.nombre}</strong>
                      </td>
                      <td>{p.categoria}</td>
                      <td className="quantity">{p.stockActual}</td>
                      <td className="mono">{p.stockMinimo}</td>
                      <td className="mono">{pen(p.precioCompra)}</td>
                      <td>
                        <Badge state={p.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.data.data.length && <Empty />}
          </section>
        </>
      )}
      <Notice>
        Máximo 1000 productos por reporte. Bajo mínimo incluye agotados. Los precios maestros no equivalen a
        valoración contable ni al último precio de una factura.
      </Notice>
    </>
  );
}
export function OverviewPage({ api }: { api: ApiClient }) {
  const report = useLoad(() => api.json<InventoryReport>('/reportes/inventario'), [api]);
  const history = useLoad(() => api.json<Page<Movement>>('/inventario/movimientos?limite=5'), [api]);
  const low = report.data?.data.filter((r) => r.stockActual <= r.stockMinimo) ?? [];
  return (
    <>
      <PageHeading title="Resumen operativo" subtitle="El estado del almacén, sin cifras simuladas.">
        <Link to="/movimiento" className="primary">
          + Registrar movimiento
        </Link>
      </PageHeading>
      {report.loading && <Loading />}
      {report.error && (
        <Notice danger>
          {report.error} Si hay más de 1000 productos, consulta inventario por categoría.
        </Notice>
      )}
      {report.data && (
        <>
          <div className="metrics">
            {[
              ['Productos activos', report.data.resumen.productos, 'blue'],
              ['Agotados', report.data.resumen.agotados, 'red'],
              ['Bajo el mínimo', report.data.resumen.bajoMinimo, 'red'],
              [
                'Con stock sobre mínimo',
                report.data.resumen.productos - report.data.resumen.bajoMinimo,
                'green',
              ],
            ].map(([label, value, color]) => (
              <article className="panel metric" key={label}>
                <span className={`metric-dot ${color}`} />
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="overview-columns">
            <section className="panel">
              <div className="section-heading">
                <h2>Actividad registrada</h2>
                <Link to="/historial">Ver historial →</Link>
              </div>
              <p>Primeros registros del historial, por ID ascendente.</p>
              {history.loading && <Loading />}
              {history.error && <Notice danger>{history.error}</Notice>}
              {history.data?.data.map((m) => (
                <div className="activity" key={m.id}>
                  <span className="tile">{m.tipo === 'ENTRADA' ? '↙' : '↗'}</span>
                  <div>
                    <strong>
                      {m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} · {m.nombre}
                    </strong>
                    <small>
                      {m.cantidad} unidades · {m.motivo}
                    </small>
                  </div>
                  <small>{new Date(m.fecha).toLocaleDateString('es-PE')}</small>
                </div>
              ))}
              {history.data?.data.length === 0 && <Empty />}
            </section>
            <section className="panel">
              <h2>Prioridad de reposición</h2>
              <p>{low.length} productos bajo mínimo</p>
              {low.slice(0, 5).map((p) => (
                <div className="replenishment" key={p.id}>
                  <div>
                    <strong>{p.nombre}</strong>
                    <small>
                      {p.stockActual} / mín. {p.stockMinimo}
                    </small>
                  </div>
                  <progress
                    max={Math.max(1, p.stockMinimo)}
                    value={Math.min(p.stockActual, p.stockMinimo)}
                    aria-label={`Stock de ${p.nombre}`}
                  />
                </div>
              ))}
              {!low.length && <Empty>No hay productos bajo mínimo.</Empty>}
              <Link className="secondary full-width" to="/inventario">
                Consultar inventario →
              </Link>
            </section>
          </div>
        </>
      )}
      <Notice>
        El correo real y la administración de usuarios desde la web están pendientes. Los roles y cuentas se
        configuran manualmente en Entra; no se simulan desde esta pantalla.
      </Notice>
    </>
  );
}
