import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import { getWorkspace } from '@/lib/api';
import { signOut } from '../login/actions';
import { switchTenant } from './actions';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { me, active } = await getWorkspace();
  // En celular solo caben cuatro secciones: Sucursales y Equipo se abren desde Negocio.
  const nav = active && (
    <>
      <NavLink href="/panel" label="Inicio" exact />
      <NavLink href="/panel/servicios" label="Servicios" />
      <NavLink href="/panel/profesionales" label="Profesionales" />
      <NavLink href="/panel/sucursales" label="Sucursales" desktopOnly />
      <NavLink href="/panel/equipo" label="Equipo" desktopOnly />
      <NavLink href="/panel/empresa" label="Negocio" alsoCurrentOnMobile={['/panel/sucursales', '/panel/equipo']} />
    </>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col lg:flex-row lg:gap-10 lg:px-8">
      <header className="flex items-center justify-between gap-4 px-5 pt-5 lg:w-60 lg:flex-none lg:flex-col lg:items-stretch lg:justify-start lg:gap-8 lg:px-0 lg:pt-10">
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold lg:text-2xl">{active?.tenant.tradeName ?? 'Tu negocio'}</p>
          <p className="truncate text-sm text-ink-soft">{active ? `${me.user.fullName}, ${active.role.name.toLowerCase()}` : me.user.email}</p>
        </div>
        {nav && <nav aria-label="Secciones" className="hidden lg:flex lg:flex-col lg:gap-1">{nav}</nav>}
        <div className="flex flex-none items-center gap-2 lg:mt-auto lg:flex-col lg:items-stretch lg:pb-10">
          {me.memberships.length > 1 && (
            <form action={switchTenant} className="hidden items-center gap-2 lg:flex">
              <label className="sr-only" htmlFor="tenantId">Cambiar de negocio</label>
              <select id="tenantId" name="tenantId" defaultValue={active?.tenant.id} className="field py-2 text-sm">
                {me.memberships.map((m) => (
                  <option key={m.tenant.id} value={m.tenant.id}>{m.tenant.tradeName}</option>
                ))}
              </select>
              <button className="btn-quiet">Cambiar</button>
            </form>
          )}
          <form action={signOut}>
            <button className="btn-quiet w-full">Cerrar sesión</button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-5 pt-8 pb-28 lg:px-0 lg:pt-10 lg:pb-16">{children}</main>

      {nav && (
        <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 flex gap-1 border-t border-line bg-white px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
          {nav}
        </nav>
      )}
    </div>
  );
}
