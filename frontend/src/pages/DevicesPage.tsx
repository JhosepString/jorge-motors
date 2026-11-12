import { useRef, useState, type FormEvent } from 'react';
import { ApiClient, errorText } from '../core/api';
import type { Page, Stock } from '../core/types';
import { Empty, Loading, Notice, PageHeading, useLoad } from '../ui/components';

interface Device { deviceId: string; active: boolean; createdAt: string; revokedAt: string | null;
  quotaRemaining: string; productsWithQuota: number }

export function DevicesPage({ api }: { api: ApiClient }) {
  const list = useLoad(() => api.json<{ data: Device[] }>('/sync/devices'), [api]);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [quotaDevice, setQuotaDevice] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [quotaError, setQuotaError] = useState('');
  const allocation = useRef<{ payload: string; id: string } | null>(null);
  const submittingQuota = useRef(false);
  const products = useLoad(() => api.json<Page<Stock>>('/inventario/stock?' +
    new URLSearchParams({ limite: '100', buscar: productSearch })), [api, productSearch]);
  const chosenProduct = products.data?.data.find((product) => product.id === Number(productId));
  const units = Number(quantity);
  const validQuantity = /^[1-9][0-9]*$/.test(quantity) && units <= 2_147_483_647 &&
    !!chosenProduct && units <= chosenProduct.stockActual;
  async function assignQuota(event: FormEvent) {
    event.preventDefault();
    if (submittingQuota.current || !quotaDevice || !validQuantity) return;
    submittingQuota.current = true;
    setBusy(true); setMessage(''); setQuotaError('');
    const draft = { deviceId: quotaDevice, productId: Number(productId), quantity: units };
    const payload = JSON.stringify(draft);
    if (!allocation.current || allocation.current.payload !== payload)
      allocation.current = { payload, id: crypto.randomUUID() };
    try {
      const result = await api.json<{ data: { remaining: number } }>('/sync/quotas', {
        method: 'POST', body: JSON.stringify({ ...draft, allocationId: allocation.current.id }),
      });
      allocation.current = null;
      setMessage(`Cupo asignado. Este equipo dispone de ${result.data.remaining} unidades de ese producto.`);
      setQuotaDevice(''); setProductId(''); setQuantity('1');
      list.reload();
    } catch (error) { setQuotaError(errorText(error)); }
    finally { submittingQuota.current = false; setBusy(false); }
  }
  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (busy || !selected || reason.trim().length < 10) return;
    setBusy(true); setMessage('');
    try {
      await api.json(`/sync/devices/${selected}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      setSelected(''); setReason(''); setMessage('Equipo revocado. Su cupo permanece reservado hasta reconciliarlo.');
      list.reload();
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeading title="Equipos" subtitle="Instalaciones registradas para el trabajo local y la sincronización." />
    <Notice>Revocar bloquea nuevos permisos, descargas y sincronizaciones de ese equipo cuando esté en línea.
      Los cupos no se liberan automáticamente: podrían existir salidas sin sincronizar.</Notice>
    {list.loading && <Loading />}
    {list.error && <Notice danger>{list.error}</Notice>}
    {!list.loading && !list.data?.data.length && <Empty>No hay equipos registrados.</Empty>}
    <div className="device-list">
      {list.data?.data.map((device) => <article className="panel device-card" key={device.deviceId}>
        <div><strong>Equipo {device.deviceId}</strong><p>Registrado: {new Date(device.createdAt).toLocaleString('es-PE')}</p>
          {device.revokedAt && <p>Revocado: {new Date(device.revokedAt).toLocaleString('es-PE')}</p>}</div>
        <div><span className={`badge ${device.active ? 'good' : 'warning'}`}>{device.active ? 'Activo' : 'Revocado'}</span>
          <p>Cupo reservado: {device.quotaRemaining} unidades en {device.productsWithQuota} productos</p></div>
        {device.active && <div className="actions">
          <button className="primary" onClick={() => { setQuotaDevice(device.deviceId); setSelected(''); setMessage(''); setQuotaError(''); }}>
            Asignar cupo local</button>
          <button className="secondary" onClick={() => { setSelected(device.deviceId); setQuotaDevice(''); setReason(''); setMessage(''); }}>
            Revocar equipo</button></div>}
      </article>)}
    </div>
    {quotaDevice && <form className="panel device-revoke" onSubmit={(event) => void assignQuota(event)}>
      <h2>Asignar cupo para salidas sin internet</h2><p>Equipo {quotaDevice}</p>
      <p>El cupo se reserva del stock disponible. El equipo lo recibirá cuando vuelva a descargar sus datos.</p>
      <label>Buscar producto<input value={productSearch} maxLength={100} placeholder="Nombre o SKU"
        onChange={(event) => { setProductSearch(event.target.value); setProductId(''); }} /></label>
      {products.loading && <Loading />}
      {products.error && <Notice danger>{products.error}</Notice>}
      <label>Producto<select required value={productId} onChange={(event) => setProductId(event.target.value)}>
        <option value="">Seleccione un producto</option>
        {products.data?.data.map((product) => <option key={product.id} value={product.id}>
          {product.sku} · {product.nombre} · stock {product.stockActual}</option>)}
      </select></label>
      {products.data && products.data.siguiente !== null &&
        <p>Hay más productos. Use la búsqueda para encontrar el que necesita.</p>}
      <label>Unidades a reservar<input required type="number" min="1" max={chosenProduct?.stockActual ?? 2_147_483_647}
        value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      {quotaError && <Notice danger>{quotaError}</Notice>}
      <div className="actions"><button type="button" className="text-button" onClick={() => { setQuotaDevice(''); setQuotaError(''); allocation.current = null; }}>Cancelar</button>
        <button className="primary" disabled={busy || !validQuantity}>{busy ? 'Asignando…' : 'Confirmar cupo'}</button></div>
    </form>}
    {selected && <form className="panel device-revoke" onSubmit={(event) => void revoke(event)}>
      <h2>Revocar equipo</h2><p>{selected}</p>
      <label>Motivo de la revocación<input required minLength={10} maxLength={300} value={reason}
        onChange={(event) => setReason(event.target.value)} /></label>
      <p>La aplicación de este equipo puede seguir registrando datos mientras esté desconectada y su permiso local siga vigente.
        Conserve el equipo o su copia local para revisar operaciones pendientes.</p>
      <div className="actions"><button type="button" className="text-button" onClick={() => setSelected('')}>Cancelar</button>
        <button className="primary" disabled={busy || reason.trim().length < 10}>{busy ? 'Revocando…' : 'Confirmar revocación'}</button></div>
    </form>}
    {message && <Notice>{message}</Notice>}
  </>;
}
