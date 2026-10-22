export interface TransactionalObserver<Event, Context> {
  actualizar(event: Readonly<Event>, context: Context): Promise<void>;
}

// Observer interno: se espera a cada suscriptor ANTES del commit de la UoW.
// No es un broker durable; la durabilidad depende de los repositorios Outbox.
export class TransactionalPublisher<Event, Context> {
  private readonly observers = new Set<TransactionalObserver<Event, Context>>();

  suscribir(observer: TransactionalObserver<Event, Context>): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  async publicar(event: Readonly<Event>, context: Context): Promise<void> {
    for (const observer of [...this.observers]) await observer.actualizar(event, context);
  }
}
