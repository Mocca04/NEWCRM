import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { AuthUser, canAccessBranch, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { CreateResourceDto, CreateTimeBlockDto, UpdateResourceDto } from './scheduling.dto';

const BLOCK_FIELDS = { id: true, kind: true, startsAt: true, endsAt: true, employeeId: true, branchId: true, reason: true } as const;
const RESOURCE_FIELDS = { id: true, branchId: true, name: true, type: true, isActive: true } as const;

@ApiTags('Bloqueos y recursos')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller()
export class SchedulingController {
  constructor(private readonly db: DbService) {}

  // ───────── Bloqueos, vacaciones y festivos ─────────

  @Get('time-blocks')
  @ApiQuery({ name: 'from', required: false, description: 'Por defecto, ahora' })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiOperation({ summary: 'Bloqueos que se cruzan con un rango de fechas' })
  blocks(
    @CurrentTenant() tenant: TenantContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId', new ParseUUIDPipe({ optional: true })) employeeId?: string,
  ) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : undefined;
    if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) throw new BadRequestException('Fechas inválidas');
    return this.db.forTenant(tenant.id, (tx) =>
      tx.timeBlock.findMany({
        where: { endsAt: { gt: start }, ...(end ? { startsAt: { lt: end } } : {}), ...(employeeId ? { employeeId } : {}) },
        orderBy: { startsAt: 'asc' },
        take: 500,
        select: BLOCK_FIELDS,
      }),
    );
  }

  @Post('time-blocks')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Bloquear un horario: de un profesional, de una sucursal o de todo el negocio (festivo)' })
  createBlock(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateTimeBlockDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('El bloqueo debe terminar después de empezar');
    return this.db.forTenant(tenant.id, async (tx) => {
      let branchId = dto.branchId;
      if (dto.employeeId) {
        const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null }, select: { branchId: true } });
        if (!employee || !canAccessBranch(tenant, employee.branchId)) throw new BadRequestException('El profesional no existe en esta empresa');
        branchId ??= employee.branchId;
      }
      if (branchId) await this.assertBranch(tx, tenant, branchId);
      else if (tenant.branchIds.length) throw new BadRequestException('Indique la sucursal: su acceso está limitado a algunas sucursales');
      const block = await tx.timeBlock.create({
        data: { tenantId: tenant.id, kind: dto.kind ?? 'BLOCK', startsAt, endsAt, employeeId: dto.employeeId, branchId, reason: dto.reason },
        select: BLOCK_FIELDS,
      });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'time_block.created', entityType: 'time_block', entityId: block.id, after: block });
      return block;
    });
  }

  @Delete('time-blocks/:id')
  @HttpCode(204)
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Quitar un bloqueo' })
  deleteBlock(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const block = await tx.timeBlock.findFirst({ where: { id }, select: BLOCK_FIELDS });
      if (!block || (block.branchId ? !canAccessBranch(tenant, block.branchId) : tenant.branchIds.length > 0)) throw new NotFoundException('Bloqueo no encontrado');
      await tx.timeBlock.delete({ where: { id } });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'time_block.deleted', entityType: 'time_block', entityId: id, before: block });
    });
  }

  // ───────── Recursos físicos ─────────

  @Get('resources')
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'Recursos físicos (sillas, cabinas). Cada fila es una unidad.' })
  resources(@CurrentTenant() tenant: TenantContext, @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string) {
    return this.db.forTenant(tenant.id, (tx) =>
      tx.resource.findMany({
        where: { ...(branchId ? { branchId } : {}), ...(tenant.branchIds.length ? { branchId: branchId && tenant.branchIds.includes(branchId) ? branchId : { in: [...tenant.branchIds] } } : {}) },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        select: RESOURCE_FIELDS,
      }),
    );
  }

  @Post('resources')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Agregar un recurso físico' })
  createResource(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateResourceDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.assertBranch(tx, tenant, dto.branchId);
      return tx.resource.create({ data: { ...dto, type: dto.type.toLowerCase(), tenantId: tenant.id }, select: RESOURCE_FIELDS });
    });
  }

  @Patch('resources/:id')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Editar o desactivar un recurso' })
  updateResource(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateResourceDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const resource = await tx.resource.findFirst({ where: { id }, select: { branchId: true } });
      if (!resource || !canAccessBranch(tenant, resource.branchId)) throw new NotFoundException('Recurso no encontrado');
      return tx.resource.update({ where: { id }, data: { ...dto, ...(dto.type ? { type: dto.type.toLowerCase() } : {}) }, select: RESOURCE_FIELDS });
    });
  }

  private async assertBranch(tx: Tx, tenant: TenantContext, branchId: string): Promise<void> {
    if (!(await tx.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true } })) || !canAccessBranch(tenant, branchId)) {
      throw new BadRequestException('La sucursal no existe en esta empresa');
    }
  }
}
