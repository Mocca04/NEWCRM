import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { createBranch, setBranchActive, updateBranch } from '../actions';

interface Branch { id: string; name: string; city: string | null; address: string | null; phone: string | null; isActive: boolean }

function BranchFields({ branch }: { branch?: Branch }) {
  return (
    <>
      <Field label="Nombre">
        <input className="field" name="name" required minLength={2} maxLength={60} defaultValue={branch?.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ciudad">
          <input className="field" name="city" maxLength={60} defaultValue={branch?.city ?? ''} />
        </Field>
        <Field label="Teléfono">
          <input className="field" name="phone" type="tel" inputMode="tel" minLength={7} maxLength={20} defaultValue={branch?.phone ?? ''} />
        </Field>
      </div>
      <Field label="Dirección">
        <input className="field" name="address" maxLength={120} defaultValue={branch?.address ?? ''} />
      </Field>
    </>
  );
}

export default async function BranchesPage() {
  const { active } = await requireWorkspace();
  const branches = await api<Branch[]>('/branches', { tenantId: active.tenant.id });
  const manage = can(active, 'branches.manage');

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Sucursales</h1>
        <p className="mt-3 text-ink-soft">Cada sucursal tendrá su propia agenda, sus profesionales y sus horarios.</p>
      </div>

      <ul className="space-y-3">
        {branches.map((branch) => (
          <li key={branch.id} className="sheet p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold">{branch.name}</h2>
                <p className="mt-1 text-ink-soft">{[branch.address, branch.city, branch.phone].filter(Boolean).join(', ') || 'Sin dirección ni teléfono todavía'}</p>
              </div>
              <span className={`flex-none rounded-full px-3 py-1 text-sm font-semibold ${branch.isActive ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
                {branch.isActive ? 'Abierta' : 'Desactivada'}
              </span>
            </div>
            {manage && (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer font-semibold text-polish">Editar</summary>
                <div className="mt-4 space-y-6">
                  <ActionForm action={updateBranch} submit="Guardar cambios">
                    <input type="hidden" name="id" value={branch.id} />
                    <BranchFields branch={branch} />
                  </ActionForm>
                  <ActionForm action={setBranchActive} submit={branch.isActive ? 'Desactivar sucursal' : 'Reactivar sucursal'} pending="Un momento…" quiet>
                    <input type="hidden" name="id" value={branch.id} />
                    <input type="hidden" name="activate" value={String(!branch.isActive)} />
                    <p className="text-sm text-ink-soft">
                      {branch.isActive ? 'Deja de aceptar reservas nuevas. Su historial se conserva.' : 'Vuelve a aceptar reservas.'}
                    </p>
                  </ActionForm>
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <section className="sheet p-5">
          <h2 className="mb-4 text-xl font-bold">Agregar sucursal</h2>
          <ActionForm action={createBranch} submit="Agregar sucursal" pending="Agregando…" resetOnSuccess>
            <BranchFields />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
