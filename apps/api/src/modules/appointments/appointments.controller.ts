import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { AppointmentStatus, Prisma, Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { AuthUser, canAccessBranch, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { isDateString } from '../../common/time';
import { DbService } from '../../database/db.service';
import { CancelDto, CreateAppointmentDto, RescheduleDto } from './appointments.dto';
import { LineRequest, Plan, Scheduler } from './scheduler';

const FIELDS = {
  id: true, branchId: true, status: true, source: true, startsAt: true, endsAt: true, totalAmount: true, depositAmount: true,
  notes: true, cancelReason: true, completedAt: true, recurrenceSeriesId: true,
  customer: { select: { id: true, fullName: true, phone: true } },
  services: {
    orderBy: { startsAt: 'asc' },
    select: { id: true, serviceId: true, employeeId: true, startsAt: true, endsAt: true, price: true, service: { select: { name: true } }, employee: { select: { fullName: true } } },
  },
} satisfies Prisma.AppointmentSelect;

type Row = Prisma.AppointmentGetPayload<{ select: typeof FIELDS }>;
const present = ({ services, ...appointment }: Row) => ({
  ...appointment,
  services: services.map(({ service, employee, ...line }) => ({ ...line, name: service.name, employeeName: employee.fullName })),
});

/** La base rechaza un solape con el código 23P01 (restricción de exclusión). */
const isDoubleBooking = (error: unknown): boolean => /23P01|no_double_booking/.test(`${(error as Error)?.message} ${JSON.stringify((error as { meta?: unknown })?.meta ?? '')} ${String((error as { cause?: unknown })?.cause ?? '')}`);
const SLOT_TAKEN = 'Ese horario acaba de ocuparse. Elige otro.';
const MAX_RANGE_DAYS = 62;

@ApiTags('Agenda')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller()
export class AppointmentsController {
  constructor(private readonly db: DbService) {}

  @Get('availability')
  @ApiQuery({ name: 'branchId' })
  @ApiQuery({ name: 'date', description: 'Día en la zona horaria de la sucursal, YYYY-MM-DD' })
  @ApiQuery({ name: 'serviceIds', description: 'Servicios separados por coma, en el orden en que se prestan' })
  @ApiQuery({ name: 'employeeId', required: false, description: 'Limitar a un profesional' })
  @ApiOperation({ summary: 'Horas de inicio disponibles para unos servicios en un día' })
  async availability(
    @CurrentTenant() tenant: TenantContext,
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @Query('date') date: string,
    @Query('serviceIds') serviceIds: string,
    @Query('employeeId', new ParseUUIDPipe({ optional: true })) employeeId?: string,
  ) {
    this.requireRead(tenant);
    if (!isDateString(date)) throw new BadRequestException('date debe tener formato YYYY-MM-DD');
    if (!canAccessBranch(tenant, branchId)) throw new BadRequestException('La sucursal no existe en esta empresa');
    const lines = this.parseLines(serviceIds, employeeId);
    return this.db.forTenant(tenant.id, async (tx) => {
      const day = new Date(`${date}T12:00:00Z`);
      const scheduler = await Scheduler.load(tx, { branchId, lines, from: day, to: day });
      const slots = scheduler.slots(date, lines, new Date());
      return {
        date,
        timezone: scheduler.branch.timezone,
        slots: slots.map((plan) => ({
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
          totalAmount: plan.totalAmount,
          employees: plan.lines.map((l) => ({ serviceId: l.serviceId, employeeId: l.employeeId, employeeName: scheduler.employeeName(l.employeeId) })),
        })),
      };
    });
  }

  @Get('appointments')
  @ApiQuery({ name: 'from', description: 'Inicio del rango (fecha y hora ISO)' })
  @ApiQuery({ name: 'to', description: 'Fin del rango. Máximo 62 días.' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: AppointmentStatus })
  @ApiOperation({ summary: 'Citas que empiezan dentro de un rango. Un profesional sin permiso general solo ve las suyas.' })
  async list(
    @CurrentUser() user: AuthUser,
    @CurrentTenant() tenant: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
    @Query('employeeId', new ParseUUIDPipe({ optional: true })) employeeId?: string,
    @Query('status') status?: string,
  ) {
    const own = this.requireRead(tenant);
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BadRequestException('Indique un rango de fechas válido (from y to)');
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new BadRequestException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    if (status && !(status in AppointmentStatus)) throw new BadRequestException('Estado desconocido');
    const rows = await this.db.forTenant(tenant.id, (tx) =>
      tx.appointment.findMany({
        where: {
          startsAt: { gte: start, lt: end },
          ...(status ? { status: status as AppointmentStatus } : {}),
          ...this.branchScope(tenant, branchId),
          ...(employeeId || own ? { services: { some: { ...(employeeId ? { employeeId } : {}), ...(own ? { employee: { userId: user.id } } : {}) } } } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: 2000,
        select: FIELDS,
      }),
    );
    return rows.map(present);
  }

  @Get('appointments/:id')
  @ApiOperation({ summary: 'Detalle de una cita' })
  async get(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const own = this.requireRead(tenant);
    return this.db.forTenant(tenant.id, async (tx) => present(await this.findOrFail(tx, tenant, id, own ? user.id : undefined)));
  }

  @Post('appointments')
  @RequirePermissions('appointments.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Repetir la petición con la misma llave devuelve la cita original en lugar de crear otra' })
  @ApiOperation({ summary: 'Crear cita. Responde 409 si el horario ya no está disponible.' })
  async create(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateAppointmentDto, @Headers('idempotency-key') key?: string) {
    if (!dto.customerId === !dto.customer) throw new BadRequestException('Indique customerId o los datos de un cliente nuevo, no ambos');
    if (!dto.walkIn && !dto.startsAt) throw new BadRequestException('Falta la fecha y hora de la cita (startsAt)');
    if (dto.walkIn && dto.repeat) throw new BadRequestException('Un cliente sin reserva no puede repetirse');
    if (!canAccessBranch(tenant, dto.branchId)) throw new BadRequestException('La sucursal no existe en esta empresa');
    if (key !== undefined && !/^[\w-]{8,100}$/.test(key)) throw new BadRequestException('Idempotency-Key debe tener entre 8 y 100 caracteres (letras, números, guiones)');
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    const start = dto.walkIn ? new Date(Math.floor(Date.now() / 60_000) * 60_000) : new Date(dto.startsAt!);

    const replay = () =>
      this.db.forTenant(tenant.id, async (tx) => {
        const stored = await tx.idempotencyKey.findFirst({ where: { scope: 'appointments.create', key: key! }, select: { requestHash: true, responseBody: true } });
        if (stored && stored.requestHash !== requestHash) throw new ConflictException('Esa Idempotency-Key ya se usó con otros datos');
        return stored?.responseBody ?? undefined;
      });
    if (key) {
      const previous = await replay();
      if (previous) return previous;
    }

    // Si otra reserva gana el mismo horario y el profesional no fue elegido a
    // mano, se vuelve a planear: puede quedar otro profesional libre.
    const flexible = dto.services.some((line) => !line.employeeId);
    for (let attempt = 1; ; attempt++) {
    try {
      return await this.db.forTenant(tenant.id, async (tx) => {
        const customerId = await this.resolveCustomer(tx, tenant.id, dto);
        const occurrences = dto.repeat ? Array.from({ length: dto.repeat.times }, (_, i) => new Date(start.getTime() + i * dto.repeat!.everyWeeks * 7 * 86_400_000)) : [start];
        const scheduler = await Scheduler.load(tx, { branchId: dto.branchId, lines: dto.services, from: start, to: occurrences[occurrences.length - 1] });
        const seriesId = dto.repeat ? randomUUID() : null;
        const created: string[] = [];
        const conflicts: { startsAt: Date; reason: string }[] = [];

        for (const [index, occurrence] of occurrences.entries()) {
          const result = scheduler.plan(occurrence, dto.services, { ignoreSchedule: dto.ignoreSchedule || dto.walkIn });
          if (!result.ok) {
            // La primera cita debe poder agendarse; las demás fechas de una serie se informan sin frenar el resto.
            if (index === 0) throw new ConflictException(result.reason);
            conflicts.push({ startsAt: occurrence, reason: result.reason });
            continue;
          }
          created.push(await this.insert(tx, tenant.id, user.id, { plan: result.plan, branchId: dto.branchId, customerId, notes: dto.notes, walkIn: dto.walkIn, seriesId }));
          scheduler.reserve(result.plan);
        }

        const first = present(await tx.appointment.findUniqueOrThrow({ where: { id: created[0] }, select: FIELDS }));
        const response = dto.repeat ? { ...first, series: { created: created.length, conflicts } } : first;
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'appointment.created', entityType: 'appointment', entityId: created[0], after: { startsAt: first.startsAt, services: first.services.map((s) => s.name), series: created.length > 1 ? created.length : undefined } });
        if (key) await tx.idempotencyKey.create({ data: { tenantId: tenant.id, scope: 'appointments.create', key, requestHash, responseStatus: 201, responseBody: JSON.parse(JSON.stringify(response)) } });
        return response;
      });
    } catch (error) {
      if (isDoubleBooking(error)) {
        if (flexible && attempt < 4) continue;
        throw new ConflictException(SLOT_TAKEN);
      }
      // Dos peticiones con la misma llave a la vez: la que pierde devuelve lo que guardó la otra.
      if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await replay();
        if (previous) return previous;
      }
      throw error;
    }
    }
  }

  @Patch('appointments/:id')
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Mover una cita o cambiar sus servicios. Solo citas pendientes o confirmadas.' })
  async reschedule(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto) {
    try {
      return await this.db.forTenant(tenant.id, async (tx) => {
        const before = await this.findOrFail(tx, tenant, id);
        if (dto.startsAt === undefined && dto.services === undefined) {
          return present(await tx.appointment.update({ where: { id }, data: { notes: dto.notes }, select: FIELDS }));
        }
        if (before.status !== 'PENDING' && before.status !== 'CONFIRMED') throw new ConflictException('Solo se pueden mover citas pendientes o confirmadas');
        const start = dto.startsAt ? new Date(dto.startsAt) : before.startsAt;
        // Al mover sin cambiar servicios se conserva el profesional de cada uno.
        const lines: LineRequest[] = dto.services ?? before.services.map((s) => ({ serviceId: s.serviceId, employeeId: s.employeeId }));
        const scheduler = await Scheduler.load(tx, { branchId: before.branchId, lines, from: start, to: start, excludeAppointmentId: id });
        const result = scheduler.plan(start, lines, { ignoreSchedule: dto.ignoreSchedule });
        if (!result.ok) throw new ConflictException(result.reason);

        // Se reemplazan las líneas: actualizar una a una chocaría con la restricción de exclusión a mitad de camino.
        await tx.appointmentService.deleteMany({ where: { appointmentId: id } });
        await tx.appointmentResource.deleteMany({ where: { appointmentId: id } });
        await tx.appointment.update({
          where: { id },
          data: { startsAt: result.plan.startsAt, endsAt: result.plan.endsAt, totalAmount: result.plan.totalAmount, depositAmount: result.plan.depositAmount, ...(dto.notes === undefined ? {} : { notes: dto.notes }) },
        });
        await this.insertLines(tx, tenant.id, id, result.plan);
        await this.emit(tx, tenant.id, 'appointment.rescheduled', id, `appointment.rescheduled:${id}:${result.plan.startsAt.toISOString()}:${Date.now()}`);
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'appointment.rescheduled', entityType: 'appointment', entityId: id, before: { startsAt: before.startsAt }, after: { startsAt: result.plan.startsAt } });
        return present(await tx.appointment.findUniqueOrThrow({ where: { id }, select: FIELDS }));
      });
    } catch (error) {
      if (isDoubleBooking(error)) throw new ConflictException(SLOT_TAKEN);
      throw error;
    }
  }

  @Post('appointments/:id/confirm')
  @HttpCode(200)
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Confirmar una cita pendiente' })
  confirm(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transition(user, tenant, id, ['PENDING'], 'CONFIRMED');
  }

  @Post('appointments/:id/start')
  @HttpCode(200)
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Marcar que la atención empezó' })
  start(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transition(user, tenant, id, ['CONFIRMED'], 'IN_PROGRESS');
  }

  @Post('appointments/:id/complete')
  @HttpCode(200)
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Marcar el servicio como completado. Repetir la llamada no tiene efecto.' })
  complete(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transition(user, tenant, id, ['IN_PROGRESS'], 'COMPLETED');
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Cancelar una cita. Libera el horario.' })
  cancel(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.transition(user, tenant, id, ['PENDING', 'CONFIRMED', 'IN_PROGRESS'], 'CANCELLED', dto.reason);
  }

  @Post('appointments/:id/no-show')
  @HttpCode(200)
  @RequirePermissions('appointments.manage')
  @ApiOperation({ summary: 'Registrar que el cliente no asistió. Libera el horario.' })
  noShow(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.transition(user, tenant, id, ['CONFIRMED'], 'NO_SHOW');
  }

  // ───────── Internos ─────────

  /** Devuelve true si el usuario solo puede ver sus propias citas. Sin ningún permiso de lectura, 403. */
  private requireRead(tenant: TenantContext): boolean {
    if (tenant.permissions.has('appointments.read') || tenant.permissions.has('appointments.manage')) return false;
    if (tenant.permissions.has('appointments.read.own')) return true;
    throw new ForbiddenException('No tiene permiso para ver la agenda');
  }

  private branchScope(tenant: TenantContext, branchId?: string) {
    if (tenant.branchIds.length === 0) return branchId ? { branchId } : {};
    return { branchId: branchId && tenant.branchIds.includes(branchId) ? branchId : { in: [...tenant.branchIds] } };
  }

  private parseLines(serviceIds: string | undefined, employeeId?: string): LineRequest[] {
    const ids = (serviceIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 8 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new BadRequestException('serviceIds debe traer entre 1 y 8 identificadores de servicio');
    return ids.map((serviceId) => ({ serviceId, employeeId }));
  }

  private async findOrFail(tx: Tx, tenant: TenantContext, id: string, ownUserId?: string): Promise<Row> {
    const appointment = await tx.appointment.findFirst({
      where: { id, ...(ownUserId ? { services: { some: { employee: { userId: ownUserId } } } } : {}) },
      select: FIELDS,
    });
    if (!appointment || !canAccessBranch(tenant, appointment.branchId)) throw new NotFoundException('Cita no encontrada');
    return appointment;
  }

  private async resolveCustomer(tx: Tx, tenantId: string, dto: CreateAppointmentDto): Promise<string> {
    if (dto.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, anonymizedAt: null }, select: { id: true } });
      if (!customer) throw new BadRequestException('El cliente no existe en esta empresa');
      return customer.id;
    }
    const { fullName, phone, email } = dto.customer!;
    const existing = await tx.customer.findFirst({ where: { phone }, select: { id: true } });
    if (existing) return existing.id;
    return (await tx.customer.create({ data: { tenantId, fullName, phone, email }, select: { id: true } })).id;
  }

  private async insert(
    tx: Tx,
    tenantId: string,
    userId: string,
    input: { plan: Plan; branchId: string; customerId: string; notes?: string; walkIn?: boolean; seriesId: string | null },
  ): Promise<string> {
    const { plan } = input;
    const appointment = await tx.appointment.create({
      data: {
        tenantId, branchId: input.branchId, customerId: input.customerId, createdBy: userId, notes: input.notes,
        // Las citas creadas por el personal nacen confirmadas; las del portal (fase 5) nacerán pendientes.
        status: input.walkIn ? 'IN_PROGRESS' : 'CONFIRMED',
        source: input.walkIn ? 'WALK_IN' : 'PANEL',
        startsAt: plan.startsAt, endsAt: plan.endsAt, totalAmount: plan.totalAmount, depositAmount: plan.depositAmount,
        recurrenceSeriesId: input.seriesId,
      },
      select: { id: true },
    });
    await this.insertLines(tx, tenantId, appointment.id, plan);
    await this.emit(tx, tenantId, 'appointment.created', appointment.id, `appointment.created:${appointment.id}`);
    return appointment.id;
  }

  private async insertLines(tx: Tx, tenantId: string, appointmentId: string, plan: Plan): Promise<void> {
    await tx.appointmentService.createMany({ data: plan.lines.map((line) => ({ ...line, tenantId, appointmentId })) });
    if (plan.resources.length) await tx.appointmentResource.createMany({ data: plan.resources.map((r) => ({ ...r, tenantId, appointmentId })) });
  }

  /** Evento para el worker (notificaciones, fidelización), escrito en la misma transacción. */
  private async emit(tx: Tx, tenantId: string, type: string, appointmentId: string, dedupeKey: string): Promise<void> {
    await tx.outboxEvent.create({ data: { tenantId, type, payload: { appointmentId }, dedupeKey } });
  }

  private async transition(user: AuthUser, tenant: TenantContext, id: string, from: AppointmentStatus[], to: AppointmentStatus, reason?: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const before = await this.findOrFail(tx, tenant, id);
      const now = new Date();
      // La condición sobre el estado hace que, entre dos peticiones simultáneas, solo una tenga efecto.
      const { count } = await tx.appointment.updateMany({
        where: { id, status: { in: from } },
        data: { status: to, ...(to === 'COMPLETED' ? { completedAt: now } : {}), ...(to === 'CANCELLED' ? { cancelledAt: now, cancelReason: reason } : {}) },
      });
      if (count === 0) {
        // Se vuelve a leer: otra petición pudo cambiar el estado mientras esta esperaba.
        const current = await tx.appointment.findUniqueOrThrow({ where: { id }, select: FIELDS });
        if (current.status === to) return present(current); // repetir la misma acción no hace nada
        throw new ConflictException(`La cita está ${STATUS_LABEL[current.status]} y no admite ese cambio`);
      }
      if (to === 'COMPLETED') await tx.customer.update({ where: { id: before.customer.id }, data: { lastVisitAt: now } });
      await this.emit(tx, tenant.id, `appointment.${to.toLowerCase()}`, id, `appointment.${to.toLowerCase()}:${id}`);
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: `appointment.${to.toLowerCase()}`, entityType: 'appointment', entityId: id, before: { status: before.status }, after: { status: to, reason } });
      return present(await tx.appointment.findUniqueOrThrow({ where: { id }, select: FIELDS }));
    });
  }
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING: 'pendiente', CONFIRMED: 'confirmada', IN_PROGRESS: 'en atención', COMPLETED: 'completada', CANCELLED: 'cancelada', NO_SHOW: 'marcada como inasistencia',
};
