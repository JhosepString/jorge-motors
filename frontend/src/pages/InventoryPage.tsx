import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, errorText, stockStatus } from '../core/api';
import type { Category, Page, Product, Profile, Stock } from '../core/types';
import { Badge, Empty, Loading, Modal, Notice, PageHeading, Pager, useLoad } from '../ui/components';
export async function categories(api: ApiClient) {
  const all: Category[] = [];
  let after = 0;
  for (let page = 0; page < 20; page++) {
    const result = await api.json<Page<Category>>(`/inventario/categorias?limite=100&despuesDe=${after}`);
    all.push(...result.data);
    if (result.siguiente === null) return all;
    after = result.siguiente;
  }
  throw new Error('Demasiadas categorías; consulta acotada pendiente.');
}
export function InventoryPage({ api, profile }: { api: ApiClient; profile: Profile }) {
  const admin = profile.rol === 'ADMINISTRADOR';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ buscar: '', categoriaId: '', estado: 'TODOS' });
  const [after, setAfter] = useState(0);
  const [editor, setEditor] = useState<number | 'nuevo' | 'categoria'>();
  const cats = useLoad(() => categories(api), [api]);
  const query = new URLSearchParams({ ...filter, despuesDe: String(after) });
  if (!filter.categoriaId) query.delete('categoriaId');
  const list = useLoad(() => api.json<Page<Stock>>('/inventario/stock?' + query), [api, filter, after]);
  function apply(event: FormEvent) {
    event.preventDefault();
    setAfter(0);
    setFilter({ ...filter, buscar: search });
  }
  return (
    <>
      <PageHeading
        title={admin ? 'Productos y existencias' : 'Consulta de stock'}
        subtitle={
          admin
            ? 'Stock actualizado después de cada entrada o salida.'
            : 'Encuentra rápido la pieza antes de iniciar un trabajo.'
        }
      >
        {admin && (
          <div className="actions">
            <button className="secondary" onClick={() => setEditor('categoria')}>
              + Categoría
            </button>
            <button className="primary" onClick={() => setEditor('nuevo')}>
              + Nuevo producto
            </button>
          </div>
        )}
      </PageHeading>
      {!admin && (
        <section className="search-banner">
          <h2>¿Qué pieza necesitas?</h2>
          <p>Busca por código o nombre. El saldo se consulta en el servidor, sin exponer precios.</p>
        </section>
      )}
      <form className="filters" onSubmit={apply}>
        <label>
          Buscar producto
          <input
            value={search}
            maxLength={100}
            placeholder="Código, nombre o categoría"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Categoría
          <select
            value={filter.categoriaId}
            onChange={(e) => {
              setAfter(0);
              setFilter({ ...filter, categoriaId: e.target.value });
            }}
          >
            {<option value="">Todas las categorías</option>}
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            value={filter.estado}
            onChange={(e) => {
              setAfter(0);
              setFilter({ ...filter, estado: e.target.value });
            }}
          >
            <option value="TODOS">Todos</option>
            <option value="NORMAL">Disponible</option>
            <option value="BAJO_MINIMO">Bajo mínimo (incluye agotados)</option>
            <option value="AGOTADO">Agotado</option>
          </select>
        </label>
        <button className="secondary" type="submit">
          Buscar
        </button>
      </form>
      {cats.error && <Notice danger>{cats.error}</Notice>}
      {list.error && (
        <Notice danger>
          {list.error}
          <button className="text-button" onClick={list.reload}>
            Reintentar
          </button>
        </Notice>
      )}
      {list.loading ? (
        <Loading />
      ) : (
        list.data && (
          <>
            {admin ? (
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Categoría</th>
                        <th>Stock</th>
                        <th>Mínimo</th>
                        <th>Estado</th>
                        <th>
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.data.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <small className="sku">{p.sku}</small>
                            <strong>{p.nombre}</strong>
                          </td>
                          <td>{p.categoria}</td>
                          <td className="quantity">{p.stockActual}</td>
                          <td className="mono">{p.stockMinimo}</td>
                          <td>
                            <Badge state={stockStatus(p)} />
                          </td>
                          <td>
                            <button className="text-button" onClick={() => setEditor(p.id)}>
                              Editar →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!list.data.data.length && <Empty />}
                <Pager after={after} next={list.data.siguiente} onNext={setAfter} reset={() => setAfter(0)} />
              </section>
            ) : (
              <>
                <div className="stock-cards">
                  {list.data.data.map((p) => (
                    <article className="panel stock-card" key={p.id}>
                      <span className="tile">{p.nombre.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <h2>{p.nombre}</h2>
                        <small className="sku">{p.sku}</small>
                        <p>{p.categoria}</p>
                      </div>
                      <strong className="quantity">{p.stockActual} unidades</strong>
                      <Badge state={stockStatus(p)} />
                      <Link className="text-button" to={`/movimiento?producto=${p.id}`}>
                        Registrar salida →
                      </Link>
                    </article>
                  ))}
                </div>
                {!list.data.data.length && <Empty />}
                <Pager after={after} next={list.data.siguiente} onNext={setAfter} reset={() => setAfter(0)} />
              </>
            )}
          </>
        )
      )}
      {editor !== undefined && (
        <Modal
          title={
            editor === 'categoria'
              ? 'Nueva categoría'
              : editor === 'nuevo'
                ? 'Nuevo producto'
                : 'Editar producto'
          }
          close={() => setEditor(undefined)}
        >
          <ProductEditor
            api={api}
            kind={editor}
            cats={cats.data ?? []}
            saved={() => {
              setEditor(undefined);
              list.reload();
              cats.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ProductEditor({
  api,
  kind,
  cats,
  saved,
}: {
  api: ApiClient;
  kind: number | 'nuevo' | 'categoria';
  cats: Category[];
  saved: () => void;
}) {
  const product = useLoad(
    () =>
      typeof kind === 'number'
        ? api.json<{ data: Product }>(`/catalogo/productos/${kind}`)
        : Promise.resolve(undefined),
    [kind, api],
  );
  if (product.loading) return <Loading />;
  if (product.error) return <Notice danger>{product.error}</Notice>;
  return (
    <ProductForm
      key={product.data?.data.version ?? String(kind)}
      api={api}
      kind={kind}
      cats={cats}
      existing={product.data?.data}
      saved={saved}
    />
  );
}
function ProductForm({
  api,
  kind,
  cats,
  existing,
  saved,
}: {
  api: ApiClient;
  kind: number | 'nuevo' | 'categoria';
  cats: Category[];
  existing: Product | undefined;
  saved: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const f = new FormData(event.currentTarget);
    const nombre = String(f.get('nombre'));
    const body =
      kind === 'categoria'
        ? { nombre }
        : {
            nombre,
            categoriaId: Number(f.get('categoria')),
            stockMinimo: Number(f.get('minimo')),
            precioCompra: String(f.get('precio')),
            ...(kind === 'nuevo' ? { sku: String(f.get('sku')) } : {}),
          };
    try {
      await api.json(
        kind === 'categoria'
          ? '/catalogo/categorias'
          : typeof kind === 'number'
            ? `/catalogo/productos/${kind}`
            : '/catalogo/productos',
        {
          method: typeof kind === 'number' ? 'PUT' : 'POST',
          headers: existing ? { 'If-Match': `"${existing.version}"` } : {},
          body: JSON.stringify(body),
        },
      );
      saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="stack">
      <label>
        Nombre
        <input
          autoFocus
          name="nombre"
          required
          maxLength={kind === 'categoria' ? 100 : 150}
          defaultValue={existing?.nombre}
        />
      </label>
      {kind !== 'categoria' && (
        <>
          {kind === 'nuevo' && (
            <label>
              SKU (inmutable)
              <input name="sku" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" />
            </label>
          )}
          <label>
            Categoría
            <select name="categoria" required defaultValue={existing?.categoriaId ?? ''}>
              <option value="">Seleccionar categoría</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              Stock mínimo
              <input
                name="minimo"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                required
                defaultValue={existing?.stockMinimo ?? 0}
              />
            </label>
            <label>
              Precio compra PEN
              <input
                name="precio"
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,15})\.[0-9]{2}"
                required
                defaultValue={existing?.precioCompra ?? '0.00'}
              />
              <small>Dos decimales, por ejemplo 25.50.</small>
            </label>
          </div>
          <Notice>
            El stock no se edita aquí. Los productos nuevos comienzan en cero; usa movimientos para registrar
            existencias.
          </Notice>
        </>
      )}
      {error && <Notice danger>{error}</Notice>}
      <button className="primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}
