import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { WEEK } from '@/lib/format';
import { createEmployee, setEmployeeActive, setSchedule, updateEmployee } from '../catalogo-actions';

interface Slot { weekday: number; startTime: string; endTime: string }
interface Employee {
  id: string; branchId: string; userId: string | null; fullName: string; specialties: string[]; commissionPercent: number;
  isActive: boolean; serviceIds: string[]; schedule: Slot[];
}
interface Branch { id: string; name: string; isActive: boolean }
interface Service { id: string; name: string }
interface Member { user: { id: string; fullName: string; email: string }; isActive: boolean }

function ServiceChecks({ services, selected = [] }: { services: Service[]; selected?: string[] }) {
  if (services.length === 0) return <p className="text-sm text-ink-soft">Cuando agregues servicios podrás marcar aquí cuáles hace.</p>;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Servicios que hace</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
            <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={selected.includes(s.id)} className="size-5 accent-polish" />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BranchSelect({ branches, value }: { branches: Branch[]; value?: string }) {
  const open = branches.filter((b) => b.isActive || b.id === value);
  if (open.length === 1) return <input type="hidden" name="branchId" value={open[0].id} />;
  return (
    <Field label="Sucursal">
      <select className="field" name="branchId" defaultValue={value}>
        {open.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </Field>
  );
}

function ScheduleSummary({ schedule }: { schedule: Slot[] }) {
  if (schedule.length === 0) return <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">Sin horario: no aparece en la agenda.</p>;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {WEEK.map(({ weekday, short }) => {
        const slots = schedule.filter((s) => s.weekday === weekday);
        return (
          <div key={weekday} className="contents">
            <dt className="font-semibold">{short}</dt>
            <dd className={slots.length ? 'tabular-nums' : 'text-ink-soft'}>
              {slots.length ? slots.map((s) => `${s.startTime} a ${s.endTime}`).join(' y ') : 'No trabaja'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ScheduleForm({ employee }: { employee: Employee }) {
  return (
    <ActionForm action={setSchedule} submit="Guardar horario">
      <input type="hidden" name="id" value={employee.id} />
      <p className="text-sm text-ink-soft">Marca los días que trabaja. El descanso es opcional: en ese rato no se le agendan citas.</p>
      <div className="space-y-3">
        {WEEK.map(({ weekday, name }) => {
          const slots = employee.schedule.filter((s) => s.weekday === weekday);
          const first = slots[0];
          const last = slots[slots.length - 1];
          return (
            <fieldset key={weekday} className="rounded-lg border border-line p-3">
              <label className="flex min-h-11 items-center gap-3 font-semibold">
                <input type="checkbox" name={`d${weekday}-on`} defaultChecked={slots.length > 0} className="size-5 accent-polish" />
                <span>{name}</span>
              </label>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Entra">
                  <input className="field px-2" type="time" name={`d${weekday}-start`} defaultValue={first?.startTime} aria-label={`${name}: hora de entrada`} />
                </Field>
                <Field label="Sale">
                  <input className="field px-2" type="time" name={`d${weekday}-end`} defaultValue={last?.endTime === '24:00' ? '23:59' : last?.endTime} aria-label={`${name}: hora de salida`} />
                </Field>
                <Field label="Descanso desde">
                  <input className="field px-2" type="time" name={`d${weekday}-bstart`} defaultValue={slots.length > 1 ? first.endTime : undefined} aria-label={`${name}: inicio del descanso`} />
                </Field>
                <Field label="Descanso hasta">
                  <input className="field px-2" type="time" name={`d${weekday}-bend`} defaultValue={slots.length > 1 ? last.startTime : undefined} aria-label={`${name}: fin del descanso`} />
                </Field>
              </div>
            </fieldset>
          );
        })}
      </div>
    </ActionForm>
  );
}

export default async function EmployeesPage() {
  const { active } = await requireWorkspace();
  const tenantId = active.tenant.id;
  const [employees, branches, services] = await Promise.all([
    api<Employee[]>('/employees', { tenantId }),
    api<Branch[]>('/branches', { tenantId }),
    api<Service[]>('/services', { tenantId }),
  ]);
  const manage = can(active, 'employees.manage');
  const members = manage && can(active, 'members.manage') ? (await api<Member[]>('/members', { tenantId })).filter((m) => m.isActive) : [];
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Profesionales</h1>
        <p className="mt-3 text-ink-soft">Quienes atienden: qué servicios hace cada uno y en qué horario. La agenda solo ofrece citas dentro de ese horario.</p>
      </div>

      {employees.length === 0 && <p className="sheet p-5 text-ink-soft">Todavía no hay profesionales.{manage ? ' Agrega el primero abajo; si atiendes tú, agrégate.' : ''}</p>}

      <ul className="space-y-3">
        {employees.map((employee) => (
          <li key={employee.id} className="sheet p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold">{employee.fullName}</h2>
                <p className="mt-1 text-ink-soft">
                  {[branches.length > 1 ? branchName(employee.branchId) : null, employee.specialties.join(', ') || null,
                    `${employee.serviceIds.length} ${employee.serviceIds.length === 1 ? 'servicio' : 'servicios'}`].filter(Boolean).join(', ')}
                </p>
              </div>
              {!employee.isActive && <span className="flex-none rounded-full bg-warn-soft px-3 py-1 text-sm font-semibold text-warn">Desactivado</span>}
            </div>
            {employee.isActive && <ScheduleSummary schedule={employee.schedule} />}
            {manage && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <details>
                  <summary className="cursor-pointer font-semibold text-polish">Horario</summary>
                  <div className="mt-4"><ScheduleForm employee={employee} /></div>
                </details>
                <details>
                  <summary className="cursor-pointer font-semibold text-polish">Datos y servicios</summary>
                  <div className="mt-4 space-y-6">
                    <ActionForm action={updateEmployee} submit="Guardar cambios">
                      <input type="hidden" name="id" value={employee.id} />
                      <Field label="Nombre">
                        <input className="field" name="fullName" required minLength={2} maxLength={80} defaultValue={employee.fullName} />
                      </Field>
                      <BranchSelect branches={branches} value={employee.branchId} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Especialidades" hint="Separadas por coma.">
                          <input className="field" name="specialties" maxLength={200} defaultValue={employee.specialties.join(', ')} />
                        </Field>
                        <Field label="Comisión" hint="Porcentaje de lo que factura. 0 si no aplica.">
                          <input className="field" name="commissionPercent" inputMode="decimal" defaultValue={employee.commissionPercent} />
                        </Field>
                      </div>
                      {members.length > 0 && (
                        <Field label="Su cuenta de acceso" hint="Si esta persona entra al panel con su propia cuenta, elígela para que vea solo su agenda.">
                          <select className="field" name="userId" defaultValue={employee.userId ?? ''}>
                            <option value="">No tiene cuenta</option>
                            {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.fullName} ({m.user.email})</option>)}
                          </select>
                        </Field>
                      )}
                      <ServiceChecks services={services} selected={employee.serviceIds} />
                    </ActionForm>
                    <ActionForm action={setEmployeeActive} submit={employee.isActive ? 'Desactivar profesional' : 'Reactivar profesional'} pending="Un momento…" quiet>
                      <input type="hidden" name="id" value={employee.id} />
                      <input type="hidden" name="activate" value={String(!employee.isActive)} />
                      <p className="text-sm text-ink-soft">
                        {employee.isActive ? 'Deja de recibir reservas y libera un cupo de tu plan. Su historial se conserva.' : 'Vuelve a recibir reservas.'}
                      </p>
                    </ActionForm>
                  </div>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <section className="sheet p-5">
          <h2 className="mb-4 text-xl font-bold">Agregar profesional</h2>
          <ActionForm action={createEmployee} submit="Agregar profesional" pending="Agregando…" resetOnSuccess>
            <Field label="Nombre">
              <input className="field" name="fullName" required minLength={2} maxLength={80} />
            </Field>
            <BranchSelect branches={branches} />
            <ServiceChecks services={services} />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
