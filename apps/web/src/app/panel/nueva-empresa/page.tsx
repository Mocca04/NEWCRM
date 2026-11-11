import { ActionForm, Field } from '@/components/action-form';
import { createTenant } from '../actions';

export default function NewTenantPage() {
  return (
    <div className="max-w-lg">
      <h1 className="text-4xl font-bold">Registra tu negocio</h1>
      <p className="mt-3 mb-8 text-ink-soft">Quedas como propietario, con una sucursal principal y 14 días de prueba. Todo se puede cambiar después.</p>
      <ActionForm action={createTenant} submit="Registrar negocio" pending="Registrando…">
        <Field label="Nombre del negocio">
          <input className="field" name="tradeName" required minLength={2} maxLength={80} placeholder="Barbería El Patio" />
        </Field>
        <Field label="Dirección web" hint="Solo minúsculas, números y guiones. Tus clientes reservarán en plataforma.com/esta-direccion.">
          <input className="field" name="slug" required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="barberia-el-patio" />
        </Field>
        <Field label="Ciudad">
          <input className="field" name="city" maxLength={60} autoComplete="address-level2" />
        </Field>
        <Field label="Teléfono del negocio">
          <input className="field" name="phone" type="tel" inputMode="tel" minLength={7} maxLength={20} autoComplete="tel" />
        </Field>
      </ActionForm>
    </div>
  );
}
