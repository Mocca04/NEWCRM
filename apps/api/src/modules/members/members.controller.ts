import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tx } from '@newcrm/database';
import { PENDING_PREFIX } from '../../auth/auth.guard';
import { audit } from '../../common/audit';
import { AuthUser, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { OWNER_ROLE } from '../../tenancy/role-templates';
import { InviteMemberDto, UpdateMemberDto } from './members.dto';

const MEMBER_FIELDS = {
  id: true, isActive: true, branchIds: true, createdAt: true,
  user: { select: { id: true, email: true, fullName: true, authProviderId: true } },
  role: { select: { id: true, name: true } },
} as const;

type MemberRow = { id: string; isActive: boolean; branchIds: string[]; createdAt: Date; user: { id: string; email: string; fullName: string; authProviderId: string }; role: { id: string; name: string } };
const present = ({ user, ...member }: MemberRow) => ({
  ...member,
  user: { id: user.id, email: user.email, fullName: user.fullName },
  /** true = fue invitado y aún no ha iniciado sesión. */
  pending: user.authProviderId.startsWith(PENDING_PREFIX),
});

@ApiTags('Miembros')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller('members')
export class MembersController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Personas con acceso a la empresa' })
  async list(@CurrentTenant() tenant: TenantContext) {
    const members = await this.db.forTenant(tenant.id, (tx) => tx.tenantMembership.findMany({ orderBy: { createdAt: 'asc' }, select: MEMBER_FIELDS }));
    return members.map(present);
  }

  @Post()
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Dar acceso a una persona por su correo. Entra cuando inicie sesión con ese correo confirmado.' })
  async invite(@CurrentUser() actor: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: InviteMemberDto) {
    const email = dto.email.toLowerCase();
    // La identidad es global: se resuelve como plataforma. El acceso a la
    // empresa se crea después dentro de su contexto RLS.
    const user =
      (await this.db.platform.user.findUnique({ where: { email }, select: { id: true } })) ??
      (await this.db.platform.user.create({ data: { email, fullName: dto.fullName, authProviderId: `${PENDING_PREFIX}${email}` }, select: { id: true } }));

    return this.db.forTenant(tenant.id, async (tx) => {
      await this.assertAssignableRole(tx, tenant, dto.roleId);
      await this.assertBranches(tx, dto.branchIds);
      if (await tx.tenantMembership.findFirst({ where: { userId: user.id }, select: { id: true } })) {
        throw new ConflictException('Esa persona ya tiene acceso a la empresa');
      }
      const member = await tx.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, roleId: dto.roleId, branchIds: dto.branchIds ?? [] },
        select: MEMBER_FIELDS,
      });
      await audit(tx, { tenantId: tenant.id, actorUserId: actor.id, action: 'member.invited', entityType: 'membership', entityId: member.id, after: { email, role: member.role.name } });
      return present(member);
    });
  }

  @Patch(':id')
  @RequirePermissions('members.manage')
  @ApiOperation({ summary: 'Cambiar rol, sucursales o acceso de un miembro. Efecto inmediato.' })
  update(@CurrentUser() actor: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    if (id === tenant.membershipId) throw new ConflictException('No puede modificar su propio acceso');
    return this.db.forTenant(tenant.id, async (tx) => {
      const before = await tx.tenantMembership.findFirst({ where: { id }, select: MEMBER_FIELDS });
      if (!before) throw new NotFoundException('Miembro no encontrado');
      // Para tocar a alguien hay que tener, como mínimo, sus mismos permisos.
      await this.assertAssignableRole(tx, tenant, before.role.id);
      if (dto.roleId) await this.assertAssignableRole(tx, tenant, dto.roleId);
      await this.assertBranches(tx, dto.branchIds);

      const after = await tx.tenantMembership.update({ where: { id }, data: dto, select: MEMBER_FIELDS });
      if (before.role.name === OWNER_ROLE && (after.role.name !== OWNER_ROLE || !after.isActive)) {
        const owners = await tx.tenantMembership.count({ where: { isActive: true, role: { name: OWNER_ROLE, isSystem: true } } });
        if (owners === 0) throw new ConflictException('La empresa debe conservar al menos un Propietario activo');
      }
      await audit(tx, {
        tenantId: tenant.id, actorUserId: actor.id, action: 'member.updated', entityType: 'membership', entityId: id,
        before: { role: before.role.name, isActive: before.isActive, branchIds: before.branchIds },
        after: { role: after.role.name, isActive: after.isActive, branchIds: after.branchIds },
      });
      return present(after);
    });
  }

  /** Un rol solo puede asignarlo quien ya tiene todos sus permisos. */
  private async assertAssignableRole(tx: Tx, tenant: TenantContext, roleId: string): Promise<void> {
    const role = await tx.role.findFirst({ where: { id: roleId }, select: { permissions: { select: { permission: { select: { code: true } } } } } });
    if (!role) throw new BadRequestException('El rol no existe en esta empresa');
    if (role.permissions.some((p) => !tenant.permissions.has(p.permission.code))) {
      throw new ForbiddenException('No puede gestionar un rol con más permisos que el suyo');
    }
  }

  private async assertBranches(tx: Tx, branchIds?: string[]): Promise<void> {
    if (!branchIds?.length) return;
    const found = await tx.branch.count({ where: { id: { in: branchIds }, deletedAt: null } });
    if (found !== branchIds.length) throw new BadRequestException('Alguna sucursal no existe en esta empresa');
  }
}
