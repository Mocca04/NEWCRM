import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { AuthUser, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { OWNER_ROLE } from '../../tenancy/role-templates';
import { CreateRoleDto, SetPermissionsDto } from './roles.dto';

const ROLE_FIELDS = { id: true, name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } } as const;
type RoleRow = { id: string; name: string; isSystem: boolean; permissions: { permission: { code: string } }[] };
const present = (role: RoleRow) => ({ id: role.id, name: role.name, isSystem: role.isSystem, permissions: role.permissions.map((p) => p.permission.code).sort() });

@ApiTags('Roles y permisos')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller()
export class RolesController {
  constructor(private readonly db: DbService) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Catalogo de permisos de la plataforma' })
  permissions(@CurrentTenant() tenant: TenantContext) {
    return this.db.forTenant(tenant.id, (tx) => tx.permission.findMany({ orderBy: { code: 'asc' }, select: { code: true, description: true } }));
  }

  @Get('roles')
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Roles de la empresa con sus permisos' })
  async list(@CurrentTenant() tenant: TenantContext) {
    const roles = await this.db.forTenant(tenant.id, (tx) => tx.role.findMany({ orderBy: { createdAt: 'asc' }, select: ROLE_FIELDS }));
    return roles.map(present);
  }

  @Post('roles')
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Crear un rol personalizado' })
  create(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateRoleDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const permissionIds = await this.resolveGrantable(tx, tenant, dto.permissionCodes);
      if (await tx.role.findFirst({ where: { name: dto.name }, select: { id: true } })) throw new ConflictException('Ya existe un rol con ese nombre');
      const role = await tx.role.create({ data: { tenantId: tenant.id, name: dto.name } });
      await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ tenantId: tenant.id, roleId: role.id, permissionId })) });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'role.created', entityType: 'role', entityId: role.id, after: { name: dto.name, permissions: dto.permissionCodes } });
      return present(await tx.role.findUniqueOrThrow({ where: { id: role.id }, select: ROLE_FIELDS }));
    });
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Reemplazar los permisos de un rol. Efecto inmediato para quienes lo tienen.' })
  setPermissions(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const role = await tx.role.findFirst({ where: { id }, select: ROLE_FIELDS });
      if (!role) throw new NotFoundException('Rol no encontrado');
      if (role.isSystem && role.name === OWNER_ROLE) throw new ConflictException('El rol Propietario no se puede modificar');
      if (role.id === tenant.roleId) throw new ConflictException('No puede modificar su propio rol');
      const permissionIds = await this.resolveGrantable(tx, tenant, dto.permissionCodes);
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ tenantId: tenant.id, roleId: id, permissionId })) });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'role.permissions_changed', entityType: 'role', entityId: id, before: present(role).permissions, after: [...dto.permissionCodes].sort() });
      return present(await tx.role.findUniqueOrThrow({ where: { id }, select: ROLE_FIELDS }));
    });
  }

  /** Nadie puede conceder un permiso que no tiene: evita escalar privilegios. */
  private async resolveGrantable(tx: Tx, tenant: TenantContext, codes: string[]): Promise<string[]> {
    const found = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    const unknown = codes.filter((code) => !found.some((p) => p.code === code));
    if (unknown.length) throw new BadRequestException(`Permisos desconocidos: ${unknown.join(', ')}`);
    const beyond = codes.filter((code) => !tenant.permissions.has(code));
    if (beyond.length) throw new ForbiddenException(`No puede conceder permisos que usted no tiene: ${beyond.join(', ')}`);
    return found.map((p) => p.id);
  }
}
