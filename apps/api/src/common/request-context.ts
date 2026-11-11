import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export interface TenantContext {
  id: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  permissions: ReadonlySet<string>;
  /** Sucursales permitidas. Vacio = todas. */
  branchIds: readonly string[];
}

export type AppRequest = Request & { user?: AuthUser; tenant?: TenantContext };

export const IS_PUBLIC = 'isPublic';
/** Ruta sin autenticacion. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const NO_TENANT = 'noTenant';
/** Ruta autenticada que no opera sobre una empresa (perfil, alta de empresa). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** Permisos que el rol del usuario debe tener en la empresa activa. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AppRequest>().user!;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  return ctx.switchToHttp().getRequest<AppRequest>().tenant!;
});

/** Si el usuario esta limitado a ciertas sucursales, indica si puede operar en esta. */
export const canAccessBranch = (tenant: TenantContext, branchId: string): boolean =>
  tenant.branchIds.length === 0 || tenant.branchIds.includes(branchId);
