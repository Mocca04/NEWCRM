import Link from 'next/link';
import { api, can, requireWorkspace } from '@/lib/api';
import { addDays, clock, today, zonedInstant } from '@/lib/time';

interface Branch { id: string; name: string; isActive: boolean; timezone: string }
interface Appointment { id: string; status: string; startsAt: string; customer: { fullName: string }; services: { name: string; employeeName: string }[] }

export default async function PanelHome() {
  const { me, active } = await requireWorkspace();
  const branches = await api<Branch[]>('/branches', { tenantId: active.tenant.id });
  const open = branches.filter((b) => b.isActive).length;
  const firstName = me.user.fullName.split(' ')[0];
  const main = branches.find((b) => b.isActive) ?? branches[0];
  const day = today(main.timezone);
  const canSeeAgenda = ['appointments.read', 'appointments.manage', 'appointments.read.own'].some((p) => can(active, p));
  const todays = canSeeAgenda
    ? (await api<Appointment[]>(`/appointments?from=${encodeURIComponent(zonedInstant(day, 0, main.timezone).toISOString())}&to=${encodeURIComponent(zonedInstant(addDays(day, 1), 0, main.timezone).toISOString())}`, { tenantId: active.tenant.id }))
        .filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')
    : [];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold sm:text-5xl">Hola, {firstName}</h1>
        <p className="mt-3 text-lg text-ink-soft">
          {active.tenant.tradeName} tiene {open} {open === 1 ? 'sucursal abierta' : 'sucursales abiertas'}.
        </p>
      </div>

      {canSeeAgenda && (
        <section className="sheet p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold">Hoy</h2>
            <Link href="/panel/agenda" className="font-semibold text-polish">Abrir la agenda</Link>
          </div>
          {todays.length === 0 ? (
            <p className="mt-2 text-ink-soft">No hay citas para hoy.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {todays.slice(0, 6).map((a) => (
                <li key={a.id} className="flex gap-3 py-2.5">
                  <span className="w-20 flex-none font-semibold tabular-nums">{clock(a.startsAt, main.timezone)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{a.customer.fullName}</span>
                    <span className="block truncate text-sm text-ink-soft">{a.services.map((s) => s.name).join(' y ')} con {[...new Set(a.services.map((s) => s.employeeName))].join(' y ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {todays.length > 6 && <p className="mt-2 text-sm text-ink-soft">Y {todays.length - 6} más.</p>}
        </section>
      )}

      <section className="sheet p-5">
        <h2 className="text-xl font-bold">La dirección de tu negocio</h2>
        <p className="mt-2 break-all rounded-lg bg-mirror px-3.5 py-3 font-semibold">plataforma.com/{active.tenant.slug}</p>
        <p className="mt-3 text-ink-soft">Ahí van a reservar tus clientes. La página de reservas todavía no está publicada; por ahora las citas las agenda tu equipo.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold">Lo que ya puedes dejar listo</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
          <li><Link href="/panel/servicios" className="block px-5 py-4 font-semibold hover:bg-mirror">Cargar tus servicios y precios</Link></li>
          <li><Link href="/panel/profesionales" className="block px-5 py-4 font-semibold hover:bg-mirror">Agregar a tus profesionales y sus horarios</Link></li>
          <li><Link href="/panel/empresa" className="block px-5 py-4 font-semibold hover:bg-mirror">Completar los datos del negocio</Link></li>
          {can(active, 'members.manage') && (
            <li><Link href="/panel/equipo" className="block px-5 py-4 font-semibold hover:bg-mirror">Dar acceso a tu equipo</Link></li>
          )}
        </ul>
        <p className="mt-4 text-ink-soft">La página para que tus clientes reserven solos llega en la siguiente entrega.</p>
      </section>
    </div>
  );
}
