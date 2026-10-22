import { useState, type FormEvent } from 'react';
import { ApiClient, errorText } from '../core/api';
import type { Page, Supplier } from '../core/types';
import { Empty, Loading, Modal, Notice, PageHeading, Pager, useLoad } from '../ui/components';
export function SuppliersPage({ api }: { api: ApiClient }) {
  const [after, setAfter] = useState(0);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Supplier | 'nuevo'>();
  const list = useLoad(
    () => api.json<Page<Supplier>>(`/compras/proveedores?despuesDe=${after}`),
    [api, after],
  );
  const rows =
    list.data?.data.filter((p) =>
      `${p.codigo} ${p.razonSocial}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeading
        title="Proveedores"
        subtitle="Contactos externos del taller, sin cuentas de acceso al sistema."
      >
        <button className="primary" onClick={() => setEditor('nuevo')}>
          + Nuevo proveedor
        </button>
      </PageHeading>
      <div className="filters">
        <label>
          Buscar en esta página
          <input
            value={search}
            maxLength={100}
            placeholder="Nombre o código"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {list.loading && <Loading />}
      {list.error && <Notice danger>{list.error}</Notice>}
      <div className="stock-cards">
        {rows.map((p) => (
          <article className="panel supplier-card" key={p.id}>
            <span className="tile">{p.razonSocial.slice(0, 2).toUpperCase()}</span>
            <div>
              <h2>{p.razonSocial}</h2>
              <small className="sku">Código {p.codigo}</small>
              <span className={`badge ${p.activo ? 'good' : ''}`}>{p.activo ? 'Activo' : 'Inactivo'}</span>
            </div>
            <div>
              <small>Contacto</small>
              <p>{p.correo ?? 'Sin correo registrado'}</p>
            </div>
            <button className="text-button" onClick={() => setEditor(p)}>
              Editar →
            </button>
          </article>
        ))}
      </div>
      {!list.loading && !rows.length && <Empty />}
      {list.data && (
        <Pager after={after} next={list.data.siguiente} onNext={setAfter} reset={() => setAfter(0)} />
      )}
      <Notice>
        Registrar un correo no envía mensajes. La integración de destinatarios y correo real continúa
        pendiente. El código no se presenta como RUC y no se ofrecen SMS ni WhatsApp.
      </Notice>
      {editor && (
        <Modal
          title={editor === 'nuevo' ? 'Nuevo proveedor' : 'Editar proveedor'}
          close={() => setEditor(undefined)}
        >
          <SupplierForm
            api={api}
            existing={editor === 'nuevo' ? undefined : editor}
            saved={() => {
              setEditor(undefined);
              list.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function SupplierForm({
  api,
  existing,
  saved,
}: {
  api: ApiClient;
  existing: Supplier | undefined;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const body = {
      razonSocial: String(f.get('nombre')).trim(),
      correo: String(f.get('correo')).trim() || null,
      ...(existing
        ? { activo: f.get('activo') === 'on' }
        : { codigo: String(f.get('codigo')).toUpperCase() }),
    };
    try {
      await api.json('/compras/proveedores' + (existing ? `/${existing.id}` : ''), {
        method: existing ? 'PUT' : 'POST',
        headers: existing ? { 'If-Match': `"${existing.version}"` } : {},
        body: JSON.stringify(body),
      });
      saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <fieldset disabled={busy}>
        {!existing && (
          <label>
            Código (inmutable)
            <input name="codigo" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" />
          </label>
        )}
        <label>
          Razón social
          <input name="nombre" autoFocus required maxLength={150} defaultValue={existing?.razonSocial} />
        </label>
        <label>
          Correo de contacto (opcional)
          <input name="correo" type="email" maxLength={254} defaultValue={existing?.correo ?? ''} />
        </label>
        {existing && (
          <label className="checkbox">
            <input name="activo" type="checkbox" defaultChecked={existing.activo} />
            Proveedor activo
          </label>
        )}
      </fieldset>
      {error && <Notice danger>{error}</Notice>}
      <button className="primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar proveedor'}
      </button>
    </form>
  );
}
