import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../core/api';
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`notice ${danger ? 'danger' : ''}`} role={danger ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Badge({ state }: { state: string }) {
  const labels: Record<string, string> = {
    NORMAL: 'Disponible',
    BAJO_MINIMO: 'Bajo mínimo',
    AGOTADO: 'Agotado',
    INACTIVO: 'Inactivo',
    BORRADOR: 'Borrador',
    RECIBIDA: 'Recibida',
    ANULADA: 'Anulada',
  };
  return (
    <span
      className={`badge ${['NORMAL', 'RECIBIDA'].includes(state) ? 'good' : ['AGOTADO', 'BAJO_MINIMO', 'ANULADA'].includes(state) ? 'warning' : ''}`}
    >
      {labels[state] ?? state}
    </span>
  );
}
export function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
export function Empty({ children = 'No hay registros para estos filtros.' }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <span aria-hidden="true">◫</span>
      <p>{children}</p>
    </div>
  );
}
export function useLoad<T>(load: () => Promise<T>, keys: unknown[]) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    set({ loading: true });
    load().then(
      (data) => {
        if (current) set({ data, loading: false });
      },
      (error: unknown) => {
        if (current) set({ error: errorText(error), loading: false });
      },
    );
    return () => {
      current = false;
    };
  }, [...keys, revision]);
  return { ...state, reload: () => setRevision((n) => n + 1) };
}
export function Loading() {
  return (
    <p className="loading" role="status">
      Consultando datos…
    </p>
  );
}
export function Pager({
  next,
  after,
  onNext,
  reset,
}: {
  next: number | null;
  after: number;
  onNext: (id: number) => void;
  reset: () => void;
}) {
  return (
    <div className="pager">
      <span>Consulta paginada · hasta 25 registros</span>
      <div>
        <button className="text-button" disabled={after === 0} onClick={reset}>
          Volver al inicio
        </button>
        <button className="secondary" disabled={next === null} onClick={() => next !== null && onNext(next)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button className="text-button" onClick={close} aria-label="Cerrar formulario">
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}
