import { ActionForm, Field } from '@/components/action-form';
import { api, can, requireWorkspace } from '@/lib/api';
import { updateTenant } from '../actions';

interface Tenant { tradeName: string; legalName: string | null; nit: string | null; slug: string; email: string; phone: string | null; city: string | null; address: string | null }

export default async function TenantPage() {
  const { active } = await requireWorkspace();
  const tenant = await api<Tenant>('/tenant', { tenantId: active.tenant.id });
  const readOnly = !can(active, 'tenant.manage');

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Datos del negocio</h1>
        <p className="mt-3 text-ink-soft">
          {readOnly ? 'Tu rol puede ver estos datos, pero no cambiarlos.' : 'Lo que verán tus clientes y lo que irá en tus comprobantes.'}
        </p>
      </div>
      <fieldset disabled={readOnly} className="min-w-0">
        <ActionForm action={updateTenant} submit="Guardar datos">
          <Field label="Nombre del negocio">
            <input className="field" name="tradeName" required minLength={2} maxLength={80} defaultValue={tenant.tradeName} />
          </Field>
          <Field label="Dirección web" hint="No se puede cambiar por ahora.">
            <input className="field bg-mirror" value={`plataforma.com/${tenant.slug}`} readOnly />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono">
              <input className="field" name="phone" type="tel" inputMode="tel" minLength={7} maxLength={20} defaultValue={tenant.phone ?? ''} />
            </Field>
            <Field label="Correo de contacto">
              <input className="field" name="email" type="email" inputMode="email" defaultValue={tenant.email} />
            </Field>
            <Field label="Ciudad">
              <input className="field" name="city" maxLength={60} defaultValue={tenant.city ?? ''} />
            </Field>
            <Field label="Dirección">
              <input className="field" name="address" maxLength={120} defaultValue={tenant.address ?? ''} />
            </Field>
            <Field label="Razón social" hint="Opcional.">
              <input className="field" name="legalName" maxLength={120} defaultValue={tenant.legalName ?? ''} />
            </Field>
            <Field label="NIT" hint="Opcional. Ejemplo: 900123456-7">
              <input className="field" name="nit" inputMode="numeric" pattern="[0-9]{6,12}(-[0-9])?" defaultValue={tenant.nit ?? ''} />
            </Field>
          </div>
        </ActionForm>
      </fieldset>
    </div>
  );
}
