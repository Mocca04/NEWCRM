import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { inviteMember, updateMember } from '../actions';

interface Role { id: string; name: string; permissions: string[] }
interface Member { id: string; isActive: boolean; pending: boolean; user: { id: string; email: string; fullName: string }; role: { id: string; name: string } }

const ROLE_HELP: Record<string, string> = {
  Propietario: 'Todo, incluida la suscripción.',
  Administrador: 'Todo menos la suscripción.',
  Recepcionista: 'Agenda, clientes, caja y canje de recompensas.',
  Profesional: 'Solo su propia agenda y sus comisiones.',
};

export default async function TeamPage() {
  const { me, active } = await requireWorkspace();
  if (!can(active, 'members.manage')) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-4xl font-bold">Equipo</h1>
        <p className="mt-3 text-ink-soft">Tu rol ({active.role.name.toLowerCase()}) no puede ver ni cambiar los accesos. Pídele a un propietario o administrador que lo haga.</p>
      </div>
    );
  }
  const tenantId = active.tenant.id;
  const [members, roles] = await Promise.all([api<Member[]>('/members', { tenantId }), api<Role[]>('/roles', { tenantId })]);
  // Solo se ofrecen roles que esta persona puede asignar: los que no superan sus propios permisos.
  const assignable = roles.filter((role) => role.permissions.every((code) => active.permissions.includes(code)));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Equipo</h1>
        <p className="mt-3 text-ink-soft">Quién puede entrar al panel de {active.tenant.tradeName} y qué puede hacer. Los cambios aplican de inmediato.</p>
      </div>

      <ul className="space-y-3">
        {members.map((member) => {
          const self = member.user.id === me.user.id;
          const editable = !self && assignable.some((role) => role.id === member.role.id);
          return (
            <li key={member.id} className="sheet p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold">{member.user.fullName}{self && ' (tú)'}</h2>
                  <p className="truncate text-ink-soft">{member.user.email}</p>
                </div>
                <span className={`flex-none rounded-full px-3 py-1 text-sm font-semibold ${!member.isActive ? 'bg-warn-soft text-warn' : member.pending ? 'bg-blush text-polish-deep' : 'bg-ok-soft text-ok'}`}>
                  {!member.isActive ? 'Sin acceso' : member.pending ? 'Aún no ha entrado' : member.role.name}
                </span>
              </div>
              {editable ? (
                <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4 border-t border-line pt-4">
                  <ActionForm action={updateMember} submit="Cambiar rol" quiet className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={member.id} />
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold">Rol</span>
                      <select name="roleId" defaultValue={member.role.id} className="field py-2">
                        {assignable.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </select>
                    </label>
                  </ActionForm>
                  <ActionForm action={updateMember} submit={member.isActive ? 'Quitar acceso' : 'Devolver acceso'} pending="Un momento…" quiet className="flex">
                    <input type="hidden" name="id" value={member.id} />
                    <input type="hidden" name="isActive" value={String(!member.isActive)} />
                  </ActionForm>
                </div>
              ) : (
                !self && <p className="mt-4 border-t border-line pt-4 text-sm text-ink-soft">Rol: {member.role.name}. Solo alguien con ese mismo nivel puede cambiarlo.</p>
              )}
            </li>
          );
        })}
      </ul>

      <section className="sheet p-5">
        <h2 className="text-xl font-bold">Dar acceso a alguien</h2>
        <p className="mt-2 mb-4 text-ink-soft">La persona entra creando su cuenta con este mismo correo. No se le envía ningún mensaje todavia: avísale tú.</p>
        <ActionForm action={inviteMember} submit="Dar acceso" pending="Guardando…" resetOnSuccess>
          <Field label="Nombre">
            <input className="field" name="fullName" required minLength={2} maxLength={80} />
          </Field>
          <Field label="Correo">
            <input className="field" type="email" name="email" inputMode="email" required />
          </Field>
          <Field label="Rol">
            <select name="roleId" className="field" required defaultValue={assignable.find((r) => r.name === 'Recepcionista')?.id}>
              {assignable.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </Field>
          <dl className="space-y-1 text-sm text-ink-soft">
            {assignable.filter((role) => ROLE_HELP[role.name]).map((role) => (
              <div key={role.id} className="flex gap-2">
                <dt className="font-semibold text-ink">{role.name}:</dt>
                <dd>{ROLE_HELP[role.name]}</dd>
              </div>
            ))}
          </dl>
        </ActionForm>
      </section>
    </div>
  );
}
