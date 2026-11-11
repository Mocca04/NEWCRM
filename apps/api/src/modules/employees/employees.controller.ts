import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Prisma, Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { livePlan, planLimitReached } from '../../common/plan';
import { AuthUser, canAccessBranch, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { CreateEmployeeDto, SetEmployeeServicesDto, SetScheduleDto, UpdateEmployeeDto } from './employees.dto';

const FIELDS = {
  id: true, branchId: true, fullName: true, photoUrl: true, specialties: true, commissionPercent: true, isActive: true,
  services: { select: { serviceId: true } },
  schedules: { select: { weekday: true, startTime: true, endTime: true }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.EmployeeSelect;

type Row = {
  commissionPercent: { toNumber(): number }; services: { serviceId: string }[];
  schedules: { weekday: number; startTime: Date; endTime: Date }[];
} & Record<string, unknown>;

// Las horas se guardan sin fecha. 24:00 se guarda como 23:59:59.
const toTime = (value: string) => new Date(`1970-01-01T${value === '24:00' ? '23:59:59' : `${value}:00`}Z`);
const fromTime = (value: Date) => {
  const text = value.toISOString().slice(11, 19);
  return text === '23:59:59' ? '24:00' : text.slice(0, 5);
};
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

const present = ({ services, schedules, commissionPercent, ...employee }: Row) => ({
  ...employee,
  commissionPercent: commissionPercent.toNumber(),
  serviceIds: services.map((s) => s.serviceId),
  schedule: schedules.map((s) => ({ weekday: s.weekday, startTime: fromTime(s.startTime), endTime: fromTime(s.endTime) })),
});

@ApiTags('Profesionales')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller('employees')
export class EmployeesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'Profesionales del negocio con sus servicios y su horario semanal' })
  async list(@CurrentTenant() tenant: TenantContext, @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string) {
    const rows = await this.db.forTenant(tenant.id, (tx) =>
      tx.employee.findMany({
        where: {
          deletedAt: null,
          ...(branchId ? { branchId } : {}),
          ...(tenant.branchIds.length ? { branchId: branchId && tenant.branchIds.includes(branchId) ? branchId : { in: [...tenant.branchIds] } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: FIELDS,
      }),
    );
    return rows.map(present);
  }

  @Post()
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Agregar profesional. Responde 402 si el plan no admite más profesionales.' })
  create(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() { serviceIds, ...dto }: CreateEmployeeDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.assertBranch(tx, tenant, dto.branchId);
      await this.assertPlanAllowsAnother(tx);
      const employee = await tx.employee.create({ data: { ...dto, tenantId: tenant.id }, select: { id: true } });
      if (serviceIds) await this.replaceServices(tx, tenant.id, employee.id, serviceIds);
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'employee.created', entityType: 'employee', entityId: employee.id, after: { fullName: dto.fullName } });
      return present(await tx.employee.findUniqueOrThrow({ where: { id: employee.id }, select: FIELDS }));
    });
  }

  @Patch(':id')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Editar profesional' })
  update(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() { serviceIds, ...dto }: UpdateEmployeeDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const before = await this.findOrFail(tx, tenant, id);
      if (dto.branchId && dto.branchId !== before.branchId) {
        await this.assertBranch(tx, tenant, dto.branchId);
        // El horario pertenece a una sucursal: al cambiar de sede se mueve con la persona.
        await tx.employeeSchedule.updateMany({ where: { employeeId: id }, data: { branchId: dto.branchId } });
      }
      await tx.employee.update({ where: { id }, data: dto });
      if (serviceIds) await this.replaceServices(tx, tenant.id, id, serviceIds);
      if (dto.commissionPercent !== undefined && dto.commissionPercent !== before.commissionPercent) {
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'employee.commission_changed', entityType: 'employee', entityId: id, before: { commissionPercent: before.commissionPercent }, after: { commissionPercent: dto.commissionPercent } });
      }
      return present(await tx.employee.findUniqueOrThrow({ where: { id }, select: FIELDS }));
    });
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Desactivar profesional: deja de recibir reservas y conserva su historial' })
  deactivate(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.setActive(user, tenant, id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Reactivar profesional. Responde 402 si el plan no admite más profesionales activos.' })
  activate(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.setActive(user, tenant, id, true);
  }

  @Put(':id/services')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Definir qué servicios presta' })
  setServices(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEmployeeServicesDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.findOrFail(tx, tenant, id);
      await this.replaceServices(tx, tenant.id, id, dto.serviceIds);
      return present(await tx.employee.findUniqueOrThrow({ where: { id }, select: FIELDS }));
    });
  }

  @Put(':id/schedule')
  @RequirePermissions('employees.manage')
  @ApiOperation({ summary: 'Definir el horario semanal. Un día sin tramos es un día que no trabaja.' })
  setSchedule(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetScheduleDto) {
    for (const entry of dto.entries) {
      if (minutes(entry.endTime) <= minutes(entry.startTime)) throw new BadRequestException('Cada tramo debe terminar después de empezar');
    }
    for (let weekday = 0; weekday <= 6; weekday++) {
      const day = dto.entries.filter((e) => e.weekday === weekday).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
      for (let i = 1; i < day.length; i++) {
        if (minutes(day[i].startTime) < minutes(day[i - 1].endTime)) throw new BadRequestException('Hay dos tramos del mismo día que se cruzan');
      }
    }
    return this.db.forTenant(tenant.id, async (tx) => {
      const employee = await this.findOrFail(tx, tenant, id);
      await tx.employeeSchedule.deleteMany({ where: { employeeId: id } });
      await tx.employeeSchedule.createMany({
        data: dto.entries.map((e) => ({ tenantId: tenant.id, employeeId: id, branchId: employee.branchId, weekday: e.weekday, startTime: toTime(e.startTime), endTime: toTime(e.endTime) })),
      });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'employee.schedule_changed', entityType: 'employee', entityId: id, after: dto.entries });
      return present(await tx.employee.findUniqueOrThrow({ where: { id }, select: FIELDS }));
    });
  }

  private setActive(user: AuthUser, tenant: TenantContext, id: string, isActive: boolean) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const employee = await this.findOrFail(tx, tenant, id);
      if (employee.isActive !== isActive) {
        if (isActive) await this.assertPlanAllowsAnother(tx);
        await tx.employee.update({ where: { id }, data: { isActive } });
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: isActive ? 'employee.activated' : 'employee.deactivated', entityType: 'employee', entityId: id });
      }
      return present(await tx.employee.findUniqueOrThrow({ where: { id }, select: FIELDS }));
    });
  }

  private async findOrFail(tx: Tx, tenant: TenantContext, id: string) {
    const employee = await tx.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true, branchId: true, isActive: true, commissionPercent: true } });
    if (!employee || !canAccessBranch(tenant, employee.branchId)) throw new NotFoundException('Profesional no encontrado');
    return { ...employee, commissionPercent: employee.commissionPercent.toNumber() };
  }

  private async assertBranch(tx: Tx, tenant: TenantContext, branchId: string): Promise<void> {
    const branch = await tx.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { isActive: true } });
    if (!branch || !canAccessBranch(tenant, branchId)) throw new BadRequestException('La sucursal no existe en esta empresa');
    if (!branch.isActive) throw new BadRequestException('La sucursal está desactivada');
  }

  private async replaceServices(tx: Tx, tenantId: string, employeeId: string, serviceIds: string[]): Promise<void> {
    if ((await tx.service.count({ where: { id: { in: serviceIds }, deletedAt: null } })) !== serviceIds.length) throw new BadRequestException('Algún servicio no existe en esta empresa');
    await tx.employeeService.deleteMany({ where: { employeeId } });
    await tx.employeeService.createMany({ data: serviceIds.map((serviceId) => ({ tenantId, employeeId, serviceId })) });
  }

  /** El límite lo decide el backend según el plan vigente. */
  private async assertPlanAllowsAnother(tx: Tx): Promise<void> {
    const plan = await livePlan(tx);
    if (plan.maxEmployees !== null && (await tx.employee.count({ where: { isActive: true, deletedAt: null } })) >= plan.maxEmployees) {
      throw planLimitReached(`El plan ${plan.name} permite ${plan.maxEmployees} profesional(es) activo(s). Cambie de plan para agregar más.`);
    }
  }
}
