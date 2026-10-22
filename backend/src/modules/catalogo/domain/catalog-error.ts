export class CatalogError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CatalogError'; }
}
