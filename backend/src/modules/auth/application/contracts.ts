import type { UsuarioInventario } from '../../inventario/application/contracts.js';

export interface VerifiedIdentity {
  tenantId: string;
  objectId: string;
  roles: string[];
}
export interface UserProfile extends UsuarioInventario { nombres: string }
export type AccessTokenVerifier = (token: string) => Promise<VerifiedIdentity>;
export interface UserProfileRepository {
  buscarIdentidad(tenantId: string, objectId: string): Promise<UserProfile | undefined>;
}
