import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { duration, pesos } from '@/lib/format';
import { createCategory, createService, deleteService, loadTemplate, updateService } from '../catalogo-actions';

interface Category { id: string; name: string; services: number }
interface Service {
  id: string; categoryId: string; name: string; price: number; durationMinutes: number; prepMinutes: number;
  cleanupMinutes: number; depositAmount: number; isPublic: boolean; employeeIds: string[];
}
interface Employee { id: string; fullName: string; isActive: boolean }

const TEMPLATES = [
  { vertical: 'BARBERSHOP', label: 'Barbería' },
  { vertical: 'MANICURE', label: 'Manicure y pedicure' },
  { vertical: 'HAIR_SALON', label: 'Peluquería' },
];

function Templates() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {TEMPLATES.map((t) => (
        <ActionForm key={t.vertical} action={loadTemplate} submit={t.label} pending="Cargando…" quiet className="space-y-2">
          <input type="hidden" name="vertical" value={t.vertical} />
        </ActionForm>
      ))}
    </div>
  );
}

function ServiceEditor({ service, categories, employees }: { service: Service; categories: Category[]; employees: Employee[] }) {
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer font-semibold text-polish">Editar</summary>
      <div className="mt-4 space-y-6">
        <ActionForm action={updateService} submit="Guardar cambios">
          <input type="hidden" name="id" value={service.id} />
          <Field label="Nombre">
            <input className="field" name="name" required minLength={2} maxLength={80} defaultValue={service.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Precio" hint="En pesos, sin puntos.">
              <input className="field" name="price" inputMode="numeric" pattern="[0-9]+" required defaultValue={service.price / 100} />
            </Field>
            <Field label="Duración en minutos">
              <input className="field" name="durationMinutes" type="number" min={5} max={720} step={5} required defaultValue={service.durationMinutes} />
            </Field>
            <Field label="Preparación antes" hint="Minutos que bloquea antes de atender.">
              <input className="field" name="prepMinutes" type="number" min={0} max={120} step={5} defaultValue={service.prepMinutes} />
            </Field>
            <Field label="Limpieza después" hint="Minutos que bloquea al terminar.">
              <input className="field" name="cleanupMinutes" type="number" min={0} max={120} step={5} defaultValue={service.cleanupMinutes} />
            </Field>
            <Field label="Anticipo para reservar" hint="En pesos. 0 si no pides anticipo.">
              <input className="field" name="depositAmount" inputMode="numeric" pattern="[0-9]+" defaultValue={service.depositAmount / 100} />
            </Field>
            <Field label="Categoría">
              <select className="field" name="categoryId" defaultValue={service.categoryId}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          {employees.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Quién lo hace</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {employees.map((e) => (
                  <label key={e.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
                    <input type="checkbox" name="employeeIds" value={e.id} defaultChecked={service.employeeIds.includes(e.id)} className="size-5 accent-polish" />
                    <span>{e.fullName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="isPublic" defaultChecked={service.isPublic} className="size-5 accent-polish" />
            <span>Mostrarlo a los clientes en la página de reservas</span>
          </label>
        </ActionForm>
        <ActionForm action={deleteService} submit="Eliminar servicio" pending="Eliminando…" quiet>
          <input type="hidden" name="id" value={service.id} />
          <p className="text-sm text-ink-soft">Deja de ofrecerse. Las citas que ya lo usaron conservan su registro.</p>
        </ActionForm>
      </div>
    </details>
  );
}

export default async function ServicesPage() {
  const { active } = await requireWorkspace();
  const tenantId = active.tenant.id;
  const [categories, services, employees] = await Promise.all([
    api<Category[]>('/service-categories', { tenantId }),
    api<Service[]>('/services', { tenantId }),
    api<Employee[]>('/employees', { tenantId }),
  ]);
  const manage = can(active, 'catalog.manage');
  const staff = employees.filter((e) => e.isActive);
  const unpriced = services.filter((s) => s.price === 0).length;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Servicios</h1>
        <p className="mt-3 text-ink-soft">
          {services.length === 0
            ? 'Lo que ofreces, cuánto dura y cuánto cuesta. De aquí sale lo que tus clientes podrán reservar.'
            : unpriced
              ? `${unpriced} ${unpriced === 1 ? 'servicio no tiene precio' : 'servicios no tienen precio'} todavía y no se muestran a los clientes.`
              : 'Los cambios de precio no afectan las citas que ya están reservadas.'}
        </p>
      </div>

      {services.length === 0 && manage && (
        <section className="sheet p-5">
          <h2 className="text-xl font-bold">Empieza con una lista hecha</h2>
          <p className="mt-2 mb-4 text-ink-soft">Carga los servicios típicos de tu tipo de negocio y ajusta precios y duraciones. Puedes cargar más de una.</p>
          <Templates />
        </section>
      )}

      {categories.map((category) => (
        <section key={category.id}>
          <h2 className="text-2xl font-bold">{category.name}</h2>
          {category.services === 0 && <p className="mt-2 text-ink-soft">Sin servicios todavía.</p>}
          <ul className="mt-3 space-y-3">
            {services.filter((s) => s.categoryId === category.id).map((service) => (
              <li key={service.id} className="sheet p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold">{service.name}</h3>
                    <p className="mt-1 text-ink-soft">
                      {duration(service.durationMinutes)}
                      {service.employeeIds.length > 0 && `, ${service.employeeIds.length} ${service.employeeIds.length === 1 ? 'profesional' : 'profesionales'}`}
                    </p>
                  </div>
                  <div className="flex-none text-right">
                    {service.price > 0 ? (
                      <p className="text-lg font-bold tabular-nums">{pesos(service.price)}</p>
                    ) : (
                      <span className="rounded-full bg-warn-soft px-3 py-1 text-sm font-semibold text-warn">Sin precio</span>
                    )}
                    {service.price > 0 && !service.isPublic && <p className="mt-1 text-sm text-ink-soft">No se muestra</p>}
                  </div>
                </div>
                {manage && <ServiceEditor service={service} categories={categories} employees={staff} />}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {manage && categories.length > 0 && (
        <section className="sheet p-5">
          <h2 className="mb-4 text-xl font-bold">Agregar servicio</h2>
          <ActionForm action={createService} submit="Agregar servicio" pending="Agregando…" resetOnSuccess>
            <Field label="Nombre">
              <input className="field" name="name" required minLength={2} maxLength={80} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Precio" hint="En pesos, sin puntos.">
                <input className="field" name="price" inputMode="numeric" pattern="[0-9]+" required />
              </Field>
              <Field label="Duración en minutos">
                <input className="field" name="durationMinutes" type="number" min={5} max={720} step={5} required defaultValue={30} />
              </Field>
              <Field label="Categoría">
                <select className="field" name="categoryId">
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
          </ActionForm>
        </section>
      )}

      {manage && (
        <section className="sheet p-5">
          <h2 className="mb-4 text-xl font-bold">Agregar categoría</h2>
          <ActionForm action={createCategory} submit="Agregar categoría" pending="Agregando…" resetOnSuccess>
            <Field label="Nombre de la categoría" hint="Por ejemplo: Cejas y pestañas.">
              <input className="field" name="name" required minLength={2} maxLength={40} />
            </Field>
          </ActionForm>
          {services.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <p className="mb-3 font-semibold">O carga una lista hecha</p>
              <Templates />
            </div>
          )}
        </section>
      )}

      {!manage && services.length === 0 && <p className="text-ink-soft">Todavía no hay servicios. Los agrega quien administra el negocio.</p>}
    </div>
  );
}
