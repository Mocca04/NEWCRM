import Link from 'next/link';
import { api, can, requireWorkspace } from '@/lib/api';

interface Branch { id: string; name: string; isActive: boolean }

export default async function PanelHome() {
  const { me, active } = await requireWorkspace();
  const branches = await api<Branch[]>('/branches', { tenantId: active.tenant.id });
  const open = branches.filter((b) => b.isActive).length;
  const firstName = me.user.fullName.split(' ')[0];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold sm:text-5xl">Hola, {firstName}</h1>
        <p className="mt-3 text-lg text-ink-soft">
          {active.tenant.tradeName} tiene {open} {open === 1 ? 'sucursal abierta' : 'sucursales abiertas'}.
        </p>
      </div>

      <section className="sheet p-5">
        <h2 className="text-xl font-bold">La dirección de tu negocio</h2>
        <p className="mt-2 break-all rounded-lg bg-mirror px-3.5 py-3 font-semibold">plataforma.com/{active.tenant.slug}</p>
        <p className="mt-3 text-ink-soft">Ahí van a reservar tus clientes cuando la agenda esté lista. Todavía no está publicada.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold">Lo que ya puedes dejar listo</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
          <li><Link href="/panel/empresa" className="block px-5 py-4 font-semibold hover:bg-mirror">Completar los datos del negocio</Link></li>
          <li><Link href="/panel/sucursales" className="block px-5 py-4 font-semibold hover:bg-mirror">Revisar tus sucursales</Link></li>
          {can(active, 'members.manage') && (
            <li><Link href="/panel/equipo" className="block px-5 py-4 font-semibold hover:bg-mirror">Dar acceso a tu equipo</Link></li>
          )}
        </ul>
        <p className="mt-4 text-ink-soft">Servicios, profesionales y agenda llegan en la siguiente entrega.</p>
      </section>
    </div>
  );
}
