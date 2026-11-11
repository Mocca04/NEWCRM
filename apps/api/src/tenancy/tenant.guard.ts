import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '@newcrm/database';
import { AppRequest, IS_PUBLIC, NO_TENANT, REQUIRED_PERMISSIONS } from '../common/request-context';
import { DbService } from '../database/db.service';

/**
 * Resuelve la empresa activa (cabecera X-Tenant-Id) contra la membresía del
 * usuario y comprueba los permisos de la ruta.
 *
 * La membresía y los permisos se leen de la base en CADA peticion: quitar un
 * permiso o desactivar a alguien tiene efecto inmediato, sin esperar a que
 * venza su token.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenantId = request.headers['x-tenant-id'];
    if (!isUuid(tenantId)) throw new BadRequestException('Falta la cabecera X-Tenant-Id o no es válida');

    const membership = await this.db.platform.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: request.user!.id } },
      select: {
        id: true,
        isActive: true,
        branchIds: true,
        tenant: { select: { status: true } },
        role: { select: { id: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } },
      },
    });
    // Misma respuesta si la empresa no existe o si el usuario no pertenece a
    // ella: no se revela que empresas existen.
    if (!membership || !membership.isActive) throw new ForbiddenException('No tiene acceso a esta empresa');
    if (membership.tenant.status !== 'ACTIVE') throw new ForbiddenException('La empresa está suspendida');

    const permissions = new Set(membership.role.permissions.map((p) => p.permission.code));
    request.tenant = {
      id: tenantId,
      membershipId: membership.id,
      roleId: membership.role.id,
      roleName: membership.role.name,
      permissions,
      branchIds: membership.branchIds,
    };

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const missing = required.filter((code) => !permissions.has(code));
    if (missing.length) throw new ForbiddenException(`No tiene permiso para esta acción (${missing.join(', ')})`);
    return true;
  }
}
