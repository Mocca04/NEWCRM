import { Body, ConflictException, Controller, Get, HttpCode, HttpException, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { AuthUser, canAccessBranch, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';

const FIELDS = {
  id: true, name: true, city: true, address: true, phone: true, timezone: true, businessHours: true,
  slotIntervalMinutes: true, isActive: true, createdAt: true,
} as const;

@ApiTags('Sucursales')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller('branches')
export class BranchesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'Sucursales de la empresa a las que el usuario tiene acceso' })
  list(@CurrentTenant() tenant: TenantContext) {
    return this.db.forTenant(tenant.id, (tx) =>
      tx.branch.findMany({
        where: { deletedAt: null, ...(tenant.branchIds.length ? { id: { in: [...tenant.branchIds] } } : {}) },
        orderBy: { createdAt: 'asc' },
        select: FIELDS,
      }),
    );
  }

  @Post()
  @RequirePermissions('branches.manage')
  @ApiOperation({ summary: 'Crear sucursal. Responde 402 si el plan no admite más sucursales.' })
  create(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateBranchDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.assertPlanAllowsAnotherBranch(tx);
      const branch = await tx.branch.create({ data: { ...dto, tenantId: tenant.id }, select: FIELDS });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'branch.created', entityType: 'branch', entityId: branch.id, after: branch });
      return branch;
    });
  }

  @Patch(':id')
  @RequirePermissions('branches.manage')
  @ApiOperation({ summary: 'Editar sucursal' })
  update(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.findOrFail(tx, tenant, id);
      return tx.branch.update({ where: { id }, data: dto, select: FIELDS });
    });
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('branches.manage')
  @ApiOperation({ summary: 'Desactivar sucursal: deja de aceptar reservas y conserva su historial' })
  deactivate(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const branch = await this.findOrFail(tx, tenant, id);
      if (!branch.isActive) return branch;
      if ((await tx.branch.count({ where: { isActive: true, deletedAt: null } })) <= 1) {
        throw new ConflictException('La empresa debe conservar al menos una sucursal activa');
      }
      const updated = await tx.branch.update({ where: { id }, data: { isActive: false }, select: FIELDS });
      // Las citas ya agendadas no se tocan: se informan para reubicarlas o cancelarlas una a una.
      const futureAppointments = await tx.appointment.count({ where: { branchId: id, startsAt: { gt: new Date() }, status: { in: ['PENDING', 'CONFIRMED'] } } });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'branch.deactivated', entityType: 'branch', entityId: id, after: { futureAppointments } });
      return { ...updated, futureAppointments };
    });
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('branches.manage')
  @ApiOperation({ summary: 'Reactivar sucursal. Responde 402 si el plan no admite más sucursales activas.' })
  activate(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const branch = await this.findOrFail(tx, tenant, id);
      if (branch.isActive) return branch;
      await this.assertPlanAllowsAnotherBranch(tx);
      const updated = await tx.branch.update({ where: { id }, data: { isActive: true }, select: FIELDS });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'branch.activated', entityType: 'branch', entityId: id });
      return updated;
    });
  }

  private async findOrFail(tx: Tx, tenant: TenantContext, id: string) {
    // RLS ya limita la busqueda a la empresa: una sucursal ajena simplemente no existe.
    const branch = await tx.branch.findFirst({ where: { id, deletedAt: null }, select: FIELDS });
    if (!branch || !canAccessBranch(tenant, id)) throw new NotFoundException('Sucursal no encontrada');
    return branch;
  }

  /** El limite lo decide el backend segun el plan vigente, no la interfaz. */
  private async assertPlanAllowsAnotherBranch(tx: Tx): Promise<void> {
    const subscription = await tx.subscription.findFirst({
      where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      select: { plan: { select: { name: true, maxBranches: true } } },
    });
    if (!subscription) throw new HttpException('La empresa no tiene una suscripción vigente', HttpStatus.PAYMENT_REQUIRED);
    const limit = subscription.plan.maxBranches;
    if (limit !== null && (await tx.branch.count({ where: { isActive: true, deletedAt: null } })) >= limit) {
      throw new HttpException(`El plan ${subscription.plan.name} permite ${limit} sucursal(es). Cambie de plan para agregar más.`, HttpStatus.PAYMENT_REQUIRED);
    }
  }
}
