import Link from 'next/link';
import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { pesos, WEEK } from '@/lib/format';
import { addDays, clock, isDate, localDate, longDate, mondayOf, monthName, today, zonedInstant } from '@/lib/time';
import { cancelAppointment, changeStatus, moveAppointment } from '../agenda-actions';

interface Branch { id: string; name: string; timezone: string; isActive: boolean }
interface Employee { id: string; fullName: string; branchId: string; isActive: boolean }
interface Line { id: string; name: string; employeeId: string; employeeName: string; startsAt: string; endsAt: string }
interface Appointment {
  id: string; status: Status; source: string; startsAt: string; endsAt: string; totalAmount: number; notes: string | null;
  cancelReason: string | null; recurrenceSeriesId: string | null; customer: { fullName: string; phone: string | null }; services: Line[];
}
type Status = 'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type View = 'dia' | 'semana' | 'mes';

const STATUS: Record<Status, { label: string; chip: string }> = {
  PENDING: { label: 'Pendiente', chip: 'bg-warn-soft text-warn' },
  CONFIRMED: { label: 'Confirmada', chip: 'bg-ok-soft text-ok' },
  IN_PROGRESS: { label: 'En atención', chip: 'bg-blush text-polish-deep' },
  COMPLETED: { label: 'Completada', chip: 'bg-mirror text-ink-soft' },
  CANCELLED: { label: 'Cancelada', chip: 'bg-mirror text-ink-soft' },
  NO_SHOW: { label: 'No asistió', chip: 'bg-warn-soft text-warn' },
};
const closed = (status: Status) => status === 'CANCELLED' || status === 'NO_SHOW';

function Chip({ status }: { status: Status }) {
  return <span className={`flex-none rounded-full px-3 py-1 text-sm font-semibold ${STATUS[status].chip}`}>{STATUS[status].label}</span>;
}

function StatusButton({ id, action, label }: { id: string; action: string; label: string }) {
  return (
    <ActionForm action={changeStatus} submit={label} pending="Un momento…" quiet className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
    </ActionForm>
  );
}

function AppointmentCard({ appointment, timezone, manage, date }: { appointment: Appointment; timezone: string; manage: boolean; date: string }) {
  const { status } = appointment;
  const open = status === 'PENDING' || status === 'CONFIRMED';
  return (
    <li className={`sheet p-4 ${closed(status) ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold tabular-nums">{clock(appointment.startsAt, timezone)} a {clock(appointment.endsAt, timezone)}</p>
          <h3 className={`mt-0.5 truncate text-lg font-bold ${closed(status) ? 'line-through' : ''}`}>{appointment.customer.fullName}</h3>
        </div>
        <Chip status={status} />
      </div>
      <p className="mt-1 text-ink-soft">
        {appointment.services.map((s) => s.name).join(' y ')}, {pesos(appointment.totalAmount)}
        {appointment.source === 'WALK_IN' && ', sin reserva'}
        {appointment.recurrenceSeriesId && ', se repite'}
      </p>
      {appointment.customer.phone && <p className="text-ink-soft"><a className="underline" href={`tel:${appointment.customer.phone}`}>{appointment.customer.phone}</a></p>}
      {appointment.notes && <p className="mt-2 rounded-lg bg-mirror px-3 py-2 text-sm">{appointment.notes}</p>}
      {status === 'CANCELLED' && appointment.cancelReason && <p className="mt-2 text-sm text-ink-soft">Motivo: {appointment.cancelReason}</p>}

      {manage && !closed(status) && status !== 'COMPLETED' && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            {status === 'PENDING' && <StatusButton id={appointment.id} action="confirm" label="Confirmar" />}
            {status === 'CONFIRMED' && <StatusButton id={appointment.id} action="start" label="Iniciar atención" />}
            {status === 'IN_PROGRESS' && <StatusButton id={appointment.id} action="complete" label="Completar" />}
            {status === 'CONFIRMED' && <StatusButton id={appointment.id} action="no-show" label="No asistió" />}
          </div>
          {open && (
            <details>
              <summary className="cursor-pointer font-semibold text-polish">Mover</summary>
              <ActionForm action={moveAppointment} submit="Mover cita" pending="Moviendo…" className="mt-3 space-y-3">
                <input type="hidden" name="id" value={appointment.id} />
                <input type="hidden" name="timezone" value={timezone} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nuevo día">
                    <input className="field px-2" type="date" name="date" required defaultValue={date} />
                  </Field>
                  <Field label="Nueva hora">
                    <input className="field px-2" type="time" name="time" required step={300} />
                  </Field>
                </div>
                <p className="text-sm text-ink-soft">Se queda con {[...new Set(appointment.services.map((s) => s.employeeName))].join(' y ')}. Si el horario está ocupado, te avisamos.</p>
              </ActionForm>
            </details>
          )}
          <details>
            <summary className="cursor-pointer font-semibold text-polish">Cancelar</summary>
            <ActionForm action={cancelAppointment} submit="Cancelar cita" pending="Cancelando…" quiet className="mt-3 space-y-3">
              <input type="hidden" name="id" value={appointment.id} />
              <Field label="Motivo" hint="Opcional. El horario queda libre de inmediato.">
                <input className="field" name="reason" maxLength={200} />
              </Field>
            </ActionForm>
          </details>
        </div>
      )}
    </li>
  );
}

const byStart = (a: Appointment, b: Appointment) => a.startsAt.localeCompare(b.startsAt);

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { active } = await requireWorkspace();
  const tenantId = active.tenant.id;
  const params = await searchParams;
  const [branches, employees] = await Promise.all([api<Branch[]>('/branches', { tenantId }), api<Employee[]>('/employees', { tenantId })]);
  const branch = branches.find((b) => b.id === params.sucursal) ?? branches.find((b) => b.isActive) ?? branches[0];
  const tz = branch.timezone;
  const now = today(tz);
  const date = isDate(params.fecha) ? params.fecha : now;
  const view: View = params.vista === 'semana' || params.vista === 'mes' ? params.vista : 'dia';
  const manage = can(active, 'appointments.manage');

  const monthStart = `${date.slice(0, 7)}-01`;
  const [from, days] = view === 'dia' ? [date, 1] : view === 'semana' ? [mondayOf(date), 7] : [mondayOf(monthStart), 42];
  const range = `from=${encodeURIComponent(zonedInstant(from, 0, tz).toISOString())}&to=${encodeURIComponent(zonedInstant(addDays(from, days), 0, tz).toISOString())}`;
  const appointments = (await api<Appointment[]>(`/appointments?branchId=${branch.id}&${range}`, { tenantId })).sort(byStart);
  const onDay = (day: string) => appointments.filter((a) => localDate(a.startsAt, tz) === day);

  const href = (next: { fecha?: string; vista?: View }) =>
    `/panel/agenda?fecha=${next.fecha ?? date}&vista=${next.vista ?? view}${branches.length > 1 ? `&sucursal=${branch.id}` : ''}`;
  const step = view === 'dia' ? 1 : view === 'semana' ? 7 : 0;
  const previous = step ? addDays(date, -step) : addDays(monthStart, -1);
  const next = step ? addDays(date, step) : addDays(monthStart, 32).slice(0, 7) + '-01';
  const title = view === 'dia' ? longDate(date) : view === 'semana' ? `Semana del ${longDate(from).replace(/^lunes /, '')}` : monthName(date);
  const [made, skipped] = (params.aviso ?? '').split('-');

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Agenda</h1>
          <p className="mt-2 text-xl font-semibold first-letter:uppercase">{title}{date === now && view === 'dia' ? ', hoy' : ''}</p>
        </div>
        {manage && <Link href={`/panel/agenda/nueva?fecha=${date < now ? now : date}${branches.length > 1 ? `&sucursal=${branch.id}` : ''}`} className="btn">Nueva cita</Link>}
      </div>

      {skipped && (
        <p role="status" className="rounded-lg bg-warn-soft px-3.5 py-3 text-warn">
          Se agendaron {made} citas de la serie. {skipped} {skipped === '1' ? 'fecha no se pudo agendar' : 'fechas no se pudieron agendar'} porque el horario ya estaba ocupado.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ fecha: previous })} className="btn-quiet" aria-label="Anterior">Anterior</Link>
        <Link href={href({ fecha: now })} className="btn-quiet">Hoy</Link>
        <Link href={href({ fecha: next })} className="btn-quiet" aria-label="Siguiente">Siguiente</Link>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
        {(['dia', 'semana', 'mes'] as const).map((v) => (
          <Link key={v} href={href({ vista: v })} aria-current={view === v ? 'page' : undefined} className={view === v ? 'btn-quiet border-ink bg-ink text-white' : 'btn-quiet'}>
            {v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}
          </Link>
        ))}
      </div>

      {branches.length > 1 && (
        <nav aria-label="Sucursal" className="flex flex-wrap gap-2">
          {branches.filter((b) => b.isActive || b.id === branch.id).map((b) => (
            <Link key={b.id} href={`/panel/agenda?fecha=${date}&vista=${view}&sucursal=${b.id}`} aria-current={b.id === branch.id ? 'page' : undefined}
              className={b.id === branch.id ? 'btn-quiet border-polish text-polish' : 'btn-quiet'}>
              {b.name}
            </Link>
          ))}
        </nav>
      )}

      {view === 'dia' && (() => {
        const staff = employees.filter((e) => e.branchId === branch.id && (e.isActive || appointments.some((a) => a.services.some((s) => s.employeeId === e.id))));
        if (appointments.length === 0) {
          return <p className="sheet p-5 text-ink-soft">No hay citas este día.{manage && staff.length === 0 ? ' Para agendar, primero agrega profesionales con horario.' : ''}</p>;
        }
        return (
          <div className="grid gap-6 lg:grid-flow-col lg:auto-cols-fr">
            {staff.map((employee) => {
              const own = appointments.filter((a) => a.services.some((s) => s.employeeId === employee.id));
              return (
                <section key={employee.id} className="min-w-0">
                  <h2 className="text-xl font-bold">{employee.fullName}</h2>
                  <p className="text-sm text-ink-soft">{own.filter((a) => !closed(a.status)).length} {own.filter((a) => !closed(a.status)).length === 1 ? 'cita' : 'citas'}</p>
                  {own.length === 0 ? <p className="mt-3 text-ink-soft">Sin citas.</p> : (
                    <ul className="mt-3 space-y-3">
                      {own.map((a) => <AppointmentCard key={a.id} appointment={a} timezone={tz} manage={manage} date={date} />)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        );
      })()}

      {view === 'semana' && (
        <div className="space-y-5">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day) => {
            const list = onDay(day);
            return (
              <section key={day}>
                <h2 className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <Link href={href({ fecha: day, vista: 'dia' })} className="text-lg font-bold first-letter:uppercase hover:text-polish">{longDate(day)}{day === now ? ', hoy' : ''}</Link>
                  <span className="text-sm text-ink-soft">{(() => { const n = list.filter((a) => !closed(a.status)).length; return n === 0 ? 'Sin citas' : n === 1 ? '1 cita' : `${n} citas`; })()}</span>
                </h2>
                <ul className="divide-y divide-line">
                  {list.map((a) => (
                    <li key={a.id} className={`flex items-center gap-3 py-2.5 ${closed(a.status) ? 'opacity-60' : ''}`}>
                      <span className="w-20 flex-none font-semibold tabular-nums">{clock(a.startsAt, tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{a.customer.fullName}</span>
                        <span className="block truncate text-sm text-ink-soft">{a.services.map((s) => s.name).join(' y ')} con {[...new Set(a.services.map((s) => s.employeeName))].join(' y ')}</span>
                      </span>
                      <Chip status={a.status} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {view === 'mes' && (
        <div>
          <div className="grid grid-cols-7 text-center text-sm font-semibold text-ink-soft">
            {WEEK.map((d) => <div key={d.weekday} className="py-2">{d.short}</div>)}
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-line gap-px">
            {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((day) => {
              const count = onDay(day).filter((a) => !closed(a.status)).length;
              const inMonth = day.slice(0, 7) === date.slice(0, 7);
              return (
                <Link key={day} href={href({ fecha: day, vista: 'dia' })} aria-label={`${longDate(day)}: ${count} ${count === 1 ? 'cita' : 'citas'}`}
                  className={`flex min-h-16 flex-col items-center justify-start gap-1 p-1.5 sm:min-h-20 ${inMonth ? 'bg-white' : 'bg-mirror text-ink-soft'} hover:bg-blush`}>
                  <span className={`flex size-7 items-center justify-center rounded-full text-sm font-semibold ${day === now ? 'bg-ink text-white' : ''}`}>{Number(day.slice(8))}</span>
                  {count > 0 && <span className="rounded-full bg-blush px-2 text-xs font-bold text-polish-deep">{count}</span>}
                </Link>
              );
            })}
          </div>
          <p className="mt-3 text-sm text-ink-soft">El número es la cantidad de citas activas del día. Toca un día para verlo.</p>
        </div>
      )}
    </div>
  );
}
