import { BadRequestException } from '@nestjs/common';
import { Tx } from '@newcrm/database';
import { addMinutes, localParts, overlaps, zonedInstant } from '../../common/time';

export interface LineRequest {
  serviceId: string;
  /** Sin profesional: cualquiera habilitado que esté libre. */
  employeeId?: string;
}

export interface PlannedLine {
  serviceId: string;
  employeeId: string;
  price: number;
  startsAt: Date;
  endsAt: Date;
  /** Incluye preparación y limpieza: es lo que la base impide solapar. */
  occupiedStart: Date;
  occupiedEnd: Date;
}

export interface Plan {
  startsAt: Date;
  endsAt: Date;
  totalAmount: number;
  depositAmount: number;
  lines: PlannedLine[];
  resources: { resourceId: string; occupiedStart: Date; occupiedEnd: Date }[];
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: string };

type Interval = [Date, Date];
interface ServiceInfo {
  id: string; name: string; price: number; durationMinutes: number; prepMinutes: number; cleanupMinutes: number;
  depositAmount: number; resourceType: string | null; employeeIds: Set<string>;
  prices: { employeeId: string | null; branchId: string | null; price: number; durationMinutes: number | null }[];
}
interface EmployeeInfo { id: string; fullName: string; schedule: { weekday: number; start: number; end: number }[] }

const DAY = 86_400_000;
const minutesOf = (time: Date): number => {
  const m = time.getUTCHours() * 60 + time.getUTCMinutes();
  return time.getUTCSeconds() === 59 && m === 1439 ? 1440 : m;
};

/**
 * Motor de disponibilidad de una sucursal para un rango de fechas.
 *
 * Considera a la vez: horario del profesional, duración, preparación,
 * limpieza, descansos (huecos del horario), bloqueos y festivos, citas
 * existentes, sucursal y recursos físicos. La base de datos tiene además una
 * restricción de exclusión, así que dos reservas simultáneas no pueden
 * quedarse con el mismo horario aunque ambas pasen por aquí.
 */
export class Scheduler {
  private constructor(
    readonly branch: { id: string; timezone: string; slotIntervalMinutes: number; isActive: boolean },
    private readonly services: Map<string, ServiceInfo>,
    private readonly employees: EmployeeInfo[],
    private readonly busy: Map<string, Interval[]>,
    private readonly resources: { id: string; type: string }[],
    private readonly resourceBusy: Map<string, Interval[]>,
  ) {}

  static async load(
    tx: Tx,
    input: { branchId: string; lines: LineRequest[]; from: Date; to: Date; excludeAppointmentId?: string },
  ): Promise<Scheduler> {
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, deletedAt: null },
      select: { id: true, timezone: true, slotIntervalMinutes: true, isActive: true },
    });
    if (!branch) throw new BadRequestException('La sucursal no existe en esta empresa');

    const serviceIds = [...new Set(input.lines.map((l) => l.serviceId))];
    const rows = await tx.service.findMany({
      where: { id: { in: serviceIds }, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, price: true, durationMinutes: true, prepMinutes: true, cleanupMinutes: true, depositAmount: true, resourceType: true,
        employees: { select: { employeeId: true } },
        prices: { select: { employeeId: true, branchId: true, price: true, durationMinutes: true } },
      },
    });
    if (rows.length !== serviceIds.length) throw new BadRequestException('Algún servicio no existe o está desactivado');
    const services = new Map(rows.map(({ employees, ...s }) => [s.id, { ...s, employeeIds: new Set(employees.map((e) => e.employeeId)) }]));

    const staff = await tx.employee.findMany({
      where: { branchId: branch.id, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, schedules: { where: { branchId: branch.id }, select: { weekday: true, startTime: true, endTime: true } } },
    });
    const employees = staff.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      schedule: e.schedules.map((s) => ({ weekday: s.weekday, start: minutesOf(s.startTime), end: minutesOf(s.endTime) })),
    }));
    for (const line of input.lines) {
      if (!line.employeeId) continue;
      if (!employees.some((e) => e.id === line.employeeId)) throw new BadRequestException('El profesional no existe, está desactivado o no atiende en esta sucursal');
      if (!services.get(line.serviceId)!.employeeIds.has(line.employeeId)) throw new BadRequestException(`El profesional elegido no presta el servicio ${services.get(line.serviceId)!.name}`);
    }

    // Un día de margen a cada lado cubre preparaciones, limpiezas y zonas horarias.
    const from = new Date(input.from.getTime() - DAY);
    const to = new Date(input.to.getTime() + DAY);
    const busy = new Map<string, Interval[]>(employees.map((e) => [e.id, []]));
    const taken = await tx.appointmentService.findMany({
      where: { active: true, occupiedEnd: { gt: from }, occupiedStart: { lt: to }, employeeId: { in: employees.map((e) => e.id) }, ...(input.excludeAppointmentId ? { NOT: { appointmentId: input.excludeAppointmentId } } : {}) },
      select: { employeeId: true, occupiedStart: true, occupiedEnd: true },
    });
    for (const t of taken) busy.get(t.employeeId)!.push([t.occupiedStart, t.occupiedEnd]);
    const blocks = await tx.timeBlock.findMany({
      where: { endsAt: { gt: from }, startsAt: { lt: to }, OR: [{ branchId: branch.id }, { branchId: null }] },
      select: { employeeId: true, startsAt: true, endsAt: true },
    });
    for (const block of blocks) {
      // Sin profesional, el bloqueo es de toda la sucursal (o de todo el negocio).
      for (const e of employees) if (!block.employeeId || block.employeeId === e.id) busy.get(e.id)!.push([block.startsAt, block.endsAt]);
    }

    const types = [...new Set([...services.values()].flatMap((s) => (s.resourceType ? [s.resourceType] : [])))];
    const resources = types.length
      ? await tx.resource.findMany({ where: { branchId: branch.id, isActive: true, type: { in: types } }, orderBy: { name: 'asc' }, select: { id: true, type: true } })
      : [];
    const resourceBusy = new Map<string, Interval[]>(resources.map((r) => [r.id, []]));
    if (resources.length) {
      const used = await tx.appointmentResource.findMany({
        where: { active: true, occupiedEnd: { gt: from }, occupiedStart: { lt: to }, resourceId: { in: resources.map((r) => r.id) }, ...(input.excludeAppointmentId ? { NOT: { appointmentId: input.excludeAppointmentId } } : {}) },
        select: { resourceId: true, occupiedStart: true, occupiedEnd: true },
      });
      for (const u of used) resourceBusy.get(u.resourceId)!.push([u.occupiedStart, u.occupiedEnd]);
    }
    return new Scheduler(branch, services, employees, busy, resources, resourceBusy);
  }

  employeeName(id: string): string {
    return this.employees.find((e) => e.id === id)?.fullName ?? '';
  }

  serviceName(id: string): string {
    return this.services.get(id)?.name ?? '';
  }

  /** Tarifa aplicable: la más específica entre profesional + sucursal, profesional, sucursal y general. */
  private terms(service: ServiceInfo, employeeId: string): { price: number; duration: number } {
    const match = (e: string | null, b: string | null) => service.prices.find((p) => p.employeeId === e && p.branchId === b);
    const found = match(employeeId, this.branch.id) ?? match(employeeId, null) ?? match(null, this.branch.id);
    return { price: found?.price ?? service.price, duration: found?.durationMinutes ?? service.durationMinutes };
  }

  private withinSchedule(employee: EmployeeInfo, start: Date, end: Date): boolean {
    const a = localParts(start, this.branch.timezone);
    const b = localParts(new Date(end.getTime() - 1), this.branch.timezone);
    if (a.date !== b.date) return false; // no se atiende cruzando la medianoche
    const endMinutes = b.minutes + 1;
    return employee.schedule.some((s) => s.weekday === a.weekday && s.start <= a.minutes && endMinutes <= s.end);
  }

  /**
   * Intenta ubicar los servicios, uno tras otro, empezando en `start`.
   * Si dos servicios seguidos los hace la misma persona, no se deja limpieza
   * ni preparación entre ellos.
   */
  plan(start: Date, lines: LineRequest[], options: { ignoreSchedule?: boolean } = {}): PlanResult {
    if (!this.branch.isActive) return { ok: false, reason: 'La sucursal está desactivada y no recibe citas nuevas' };
    const planned: PlannedLine[] = [];
    const resourceUse = new Map<string, Interval>();
    let cursor = start;
    let deposit = 0;

    for (const line of lines) {
      const service = this.services.get(line.serviceId)!;
      const previous = planned[planned.length - 1];
      const candidates = this.employees
        .filter((e) => (line.employeeId ? e.id === line.employeeId : service.employeeIds.has(e.id)))
        .sort((x, y) => Number(y.id === previous?.employeeId) - Number(x.id === previous?.employeeId));
      if (candidates.length === 0) return { ok: false, reason: `Nadie en esta sucursal presta el servicio ${service.name}` };

      let reason = '';
      let chosen: PlannedLine | undefined;
      for (const employee of candidates) {
        const { price, duration } = this.terms(service, employee.id);
        const follows = previous?.employeeId === employee.id;
        const startsAt = cursor;
        const endsAt = addMinutes(startsAt, duration);
        const occupiedStart = follows ? startsAt : addMinutes(startsAt, -service.prepMinutes);
        const occupiedEnd = addMinutes(endsAt, service.cleanupMinutes);

        if (!options.ignoreSchedule && !this.withinSchedule(employee, occupiedStart, occupiedEnd)) {
          reason ||= `${employee.fullName} no trabaja a esa hora`;
          continue;
        }
        const own = planned.filter((p) => p.employeeId === employee.id && p !== (follows ? previous : undefined));
        const clash =
          this.busy.get(employee.id)!.some(([s, e]) => overlaps(occupiedStart, occupiedEnd, s, e)) ||
          own.some((p) => overlaps(occupiedStart, occupiedEnd, p.occupiedStart, p.occupiedEnd));
        if (clash) {
          reason = `${employee.fullName} ya tiene ese horario ocupado`;
          continue;
        }
        if (service.resourceType) {
          const free = this.resources.find((r) => {
            if (r.type !== service.resourceType) return false;
            if (this.resourceBusy.get(r.id)!.some(([s, e]) => overlaps(occupiedStart, occupiedEnd, s, e))) return false;
            return true;
          });
          if (!free) {
            reason = `No hay ${service.resourceType} libre a esa hora`;
            continue;
          }
          const used = resourceUse.get(free.id);
          resourceUse.set(free.id, used ? [used[0] < occupiedStart ? used[0] : occupiedStart, used[1] > occupiedEnd ? used[1] : occupiedEnd] : [occupiedStart, occupiedEnd]);
        }
        if (follows) previous.occupiedEnd = previous.endsAt;
        chosen = { serviceId: service.id, employeeId: employee.id, price, startsAt, endsAt, occupiedStart, occupiedEnd };
        break;
      }
      if (!chosen) return { ok: false, reason };
      planned.push(chosen);
      deposit += service.depositAmount;
      cursor = chosen.endsAt;
    }

    const totalAmount = planned.reduce((sum, p) => sum + p.price, 0);
    return {
      ok: true,
      plan: {
        startsAt: start,
        endsAt: cursor,
        totalAmount,
        depositAmount: Math.min(deposit, totalAmount),
        lines: planned,
        resources: [...resourceUse].map(([resourceId, [occupiedStart, occupiedEnd]]) => ({ resourceId, occupiedStart, occupiedEnd })),
      },
    };
  }

  /** Marca como ocupado un plan recién agendado, para que las siguientes citas de la misma serie no lo pisen. */
  reserve(plan: Plan): void {
    for (const line of plan.lines) this.busy.get(line.employeeId)?.push([line.occupiedStart, line.occupiedEnd]);
    for (const r of plan.resources) this.resourceBusy.get(r.resourceId)?.push([r.occupiedStart, r.occupiedEnd]);
  }

  /** Horas de inicio posibles en un día local de la sucursal, a partir de `notBefore`. */
  slots(date: string, lines: LineRequest[], notBefore: Date): Plan[] {
    const found: Plan[] = [];
    for (let minute = 0; minute < 1440; minute += this.branch.slotIntervalMinutes) {
      const start = zonedInstant(date, minute, this.branch.timezone);
      if (start < notBefore || localParts(start, this.branch.timezone).date !== date) continue;
      const result = this.plan(start, lines);
      if (result.ok) found.push(result.plan);
    }
    return found;
  }
}
