import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/action-form';
import { api, ApiError, can, requireWorkspace } from '@/lib/api';
import { duration, pesos } from '@/lib/format';
import { clock, isDate, longDate, today } from '@/lib/time';
import { createAppointment } from '../../agenda-actions';

interface Branch { id: string; name: string; timezone: string; isActive: boolean }
interface Employee { id: string; fullName: string; branchId: string; isActive: boolean; serviceIds: string[] }
interface Service { id: string; name: string; price: number; durationMinutes: number; employeeIds: string[] }
interface Slot { startsAt: string; endsAt: string; totalAmount: number; employees: { employeeName: string }[] }

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { active } = await requireWorkspace();
  if (!can(active, 'appointments.manage')) redirect('/panel/agenda');
  const tenantId = active.tenant.id;
  const params = await searchParams;
  const one = (name: string) => (Array.isArray(params[name]) ? params[name][0] : params[name]) as string | undefined;
  const many = (name: string) => (params[name] === undefined ? [] : Array.isArray(params[name]) ? params[name] : [params[name]]) as string[];

  const [branches, employees, services] = await Promise.all([
    api<Branch[]>('/branches', { tenantId }),
    api<Employee[]>('/employees', { tenantId }),
    api<Service[]>('/services', { tenantId }),
  ]);
  const branch = branches.find((b) => b.id === one('sucursal') && b.isActive) ?? branches.find((b) => b.isActive) ?? branches[0];
  const tz = branch.timezone;
  const staff = employees.filter((e) => e.branchId === branch.id && e.isActive);
  const offered = services.filter((s) => s.employeeIds.some((id) => staff.some((e) => e.id === id)));
  const date = isDate(one('fecha')) && one('fecha')! >= today(tz) ? one('fecha')! : today(tz);
  const chosen = many('servicio').filter((id) => offered.some((s) => s.id === id));
  const employeeId = staff.find((e) => e.id === one('profesional'))?.id;

  let slots: Slot[] | undefined;
  let problem: string | undefined;
  if (chosen.length) {
    try {
      const query = `branchId=${branch.id}&date=${date}&serviceIds=${chosen.join(',')}${employeeId ? `&employeeId=${employeeId}` : ''}`;
      slots = (await api<{ slots: Slot[] }>(`/availability?${query}`, { tenantId })).slots;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = error.message;
    }
  }
  const picked = offered.filter((s) => chosen.includes(s.id));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link href={`/panel/agenda?fecha=${date}`} className="font-semibold text-polish">Volver a la agenda</Link>
        <h1 className="mt-3 text-4xl font-bold">Nueva cita</h1>
      </div>

      {offered.length === 0 ? (
        <p className="sheet p-5 text-ink-soft">
          Para agendar necesitas al menos un servicio con un profesional que lo haga. Revisa <Link className="font-semibold text-polish" href="/panel/servicios">Servicios</Link> y <Link className="font-semibold text-polish" href="/panel/profesionales">Profesionales</Link>.
        </p>
      ) : (
        <section className="sheet p-5">
          <h2 className="mb-4 text-xl font-bold">Qué y cuándo</h2>
          <form method="get" className="space-y-4">
            {branches.filter((b) => b.isActive).length > 1 && (
              <Field label="Sucursal">
                <select className="field" name="sucursal" defaultValue={branch.id}>
                  {branches.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Servicios</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {offered.map((s) => (
                  <label key={s.id} className="flex min-h-12 items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <input type="checkbox" name="servicio" value={s.id} defaultChecked={chosen.includes(s.id)} className="size-5 flex-none accent-polish" />
                    <span className="min-w-0">
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-sm text-ink-soft">{duration(s.durationMinutes)}, {s.price ? pesos(s.price) : 'sin precio'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Profesional">
                <select className="field" name="profesional" defaultValue={employeeId ?? ''}>
                  <option value="">Cualquiera que esté libre</option>
                  {staff.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </select>
              </Field>
              <Field label="Día">
                <input className="field" type="date" name="fecha" required min={today(tz)} defaultValue={date} />
              </Field>
            </div>
            <button className="btn w-full sm:w-auto">Ver horas disponibles</button>
          </form>
        </section>
      )}

      {problem && <p role="alert" className="rounded-lg bg-blush px-3.5 py-3 text-polish-deep">{problem}</p>}

      {slots && (
        <section className="sheet p-5">
          <h2 className="text-xl font-bold first-letter:uppercase">{longDate(date)}</h2>
          <p className="mt-1 mb-4 text-ink-soft">{picked.map((s) => s.name).join(' y ')}{employeeId ? ` con ${staff.find((e) => e.id === employeeId)!.fullName}` : ''}</p>
          <ActionForm action={createAppointment} submit="Agendar cita" pending="Agendando…">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="branchId" value={branch.id} />
            <input type="hidden" name="timezone" value={tz} />
            {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
            {chosen.map((id) => <input key={id} type="hidden" name="serviceIds" value={id} />)}

            {slots.length === 0 ? (
              <p className="rounded-lg bg-warn-soft px-3.5 py-3 text-warn">No hay horas libres ese día para lo que elegiste. Prueba otro día u otro profesional.</p>
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Hora</legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((slot) => (
                    <label key={slot.startsAt} className="relative">
                      <input type="radio" name="startsAt" value={slot.startsAt} required className="peer sr-only" />
                      <span className="flex min-h-12 items-center justify-center rounded-lg border border-line bg-white px-1 text-center text-sm font-semibold whitespace-nowrap tabular-nums sm:text-base peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-polish">
                        {clock(slot.startsAt, tz)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {slots.length > 0 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre del cliente">
                    <input className="field" name="fullName" required minLength={2} maxLength={80} autoComplete="off" />
                  </Field>
                  <Field label="Celular" hint="Si ya es cliente, se usa su ficha.">
                    <input className="field" name="phone" type="tel" inputMode="tel" required pattern="[0-9+ ()\-]{7,20}" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Nota" hint="Opcional. Solo la ve tu equipo.">
                  <input className="field" name="notes" maxLength={500} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Se repite">
                    <select className="field" name="everyWeeks" defaultValue="0">
                      <option value="0">No se repite</option>
                      <option value="1">Cada semana</option>
                      <option value="2">Cada 2 semanas</option>
                      <option value="4">Cada 4 semanas</option>
                    </select>
                  </Field>
                  <Field label="Cuántas citas en total" hint="Solo si se repite.">
                    <input className="field" name="times" type="number" min={2} max={26} defaultValue={4} />
                  </Field>
                </div>
              </>
            )}
          </ActionForm>
        </section>
      )}

      {offered.length > 0 && (
        <section className="sheet p-5">
          <h2 className="text-xl font-bold">Llegó sin reserva</h2>
          <p className="mt-1 mb-4 text-ink-soft">Lo registra como atención que empieza ahora, aunque esté fuera del horario.</p>
          <ActionForm action={createAppointment} submit="Atender ahora" pending="Registrando…">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="walkIn" value="true" />
            <input type="hidden" name="branchId" value={branch.id} />
            <input type="hidden" name="timezone" value={tz} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Servicio">
                <select className="field" name="serviceIds" aria-label="Servicio sin reserva">
                  {offered.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Lo atiende">
                <select className="field" name="employeeId" aria-label="Profesional sin reserva" defaultValue="">
                  <option value="">Cualquiera que esté libre</option>
                  {staff.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </select>
              </Field>
              <Field label="Nombre">
                <input className="field" name="fullName" required minLength={2} maxLength={80} autoComplete="off" aria-label="Nombre del cliente sin reserva" />
              </Field>
              <Field label="Celular">
                <input className="field" name="phone" type="tel" inputMode="tel" required pattern="[0-9+ ()\-]{7,20}" autoComplete="off" aria-label="Celular del cliente sin reserva" />
              </Field>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
