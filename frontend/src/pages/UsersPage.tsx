import { useState, type FormEvent } from 'react';
import { ApiClient, errorText } from '../core/api';
import { Loading, Notice, PageHeading, useLoad } from '../ui/components';

type Role = 'ADMINISTRADOR' | 'MECANICO';
type User = { id: number; objectId: string; nombres: string; rol: Role; activo: boolean };

export function UsersPage({ api }: { api: ApiClient }) {
  const users = useLoad(() => api.json<{ data: User[] }>('/auth/users'), [api]);
  const [objectId, setObjectId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('MECANICO');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = users.data?.data.find((item) => item.id === editing);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.json(editing === null ? '/auth/users' : `/auth/users/${editing}`, {
        method: editing === null ? 'POST' : 'PATCH',
        body: JSON.stringify({ ...(editing === null ? { objectId: objectId.trim() } : {}),
          nombres: name.trim(), rol: role, activo: selected?.activo ?? true }),
      });
      setMessage(editing === null ? 'Perfil registrado. Comprueba que el rol en la aplicación empresarial de Entra coincida.'
        : 'Perfil actualizado. Comprueba que el rol en Entra coincida.');
      setEditing(null); setObjectId(''); setName(''); setRole('MECANICO'); users.reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function changeStatus(user: User) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.json(`/auth/users/${user.id}`, { method: 'PATCH',
        body: JSON.stringify({ nombres: user.nombres, rol: user.rol, activo: !user.activo }) });
      setMessage(user.activo ? 'Perfil desactivado en Jorge Motors. Retira también su acceso en Entra.'
        : 'Perfil reactivado. Comprueba su asignación en Entra.');
      users.reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading title="Usuarios" subtitle="Perfiles y permisos de Jorge Motors" />
    <Notice>Primero crea la cuenta en Microsoft Entra. En la aplicación empresarial de la API asigna el rol
      Administrador o Mecánico y copia el «Id. de objeto» del usuario. Registra aquí ese mismo rol.
      Para dar de baja a alguien, desactiva este perfil y retira también su acceso en Entra.</Notice>
    {message && <Notice>{message}</Notice>}
    {error && <Notice danger>{error}</Notice>}
    {users.error && <Notice danger>{users.error}</Notice>}
    {users.loading && <Loading />}
    <section className="panel table-panel"><h2>Perfiles registrados</h2>
      <div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th>Id. de objeto Entra</th><th>Acciones</th></tr></thead>
        <tbody>{users.data?.data.map((user) => <tr key={user.id}><td>{user.nombres}</td>
          <td>{user.rol === 'ADMINISTRADOR' ? 'Administrador' : 'Mecánico'}</td>
          <td>{user.activo ? 'Activo' : 'Desactivado'}</td><td><small className="sku">{user.objectId}</small></td>
          <td><button className="text-button" disabled={busy} onClick={() => {
            setEditing(user.id); setName(user.nombres); setRole(user.rol); setError('');
          }}>Editar</button>{' '}
            <button className="text-button" disabled={busy} onClick={() => void changeStatus(user)}>
              {user.activo ? 'Desactivar' : 'Reactivar'}</button></td></tr>)}</tbody></table></div>
      {!users.data?.data.length && !users.loading && <p>No hay perfiles disponibles.</p>}
    </section>
    <section className="panel form-panel"><h2>{editing === null ? 'Registrar perfil' : 'Editar perfil'}</h2>
      <form className="stack" onSubmit={(event) => void save(event)}>
        {editing === null && <label>Id. de objeto de Microsoft Entra<input required value={objectId}
          placeholder="UUID del usuario, no de la aplicación" onChange={(event) => setObjectId(event.target.value)} /></label>}
        <label>Nombre para mostrar<input required maxLength={150} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>Rol<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="MECANICO">Mecánico</option><option value="ADMINISTRADOR">Administrador</option></select></label>
        <div className="actions">{editing !== null && <button type="button" className="secondary" onClick={() => {
          setEditing(null); setName(''); setRole('MECANICO');
        }}>Cancelar</button>}
          <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar perfil'}</button></div>
      </form>
    </section>
  </>;
}
