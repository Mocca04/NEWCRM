import Link from 'next/link';
import { ActionForm, Field } from '@/components/action-form';
import { AuthShell } from '@/components/auth-shell';
import { signUp } from '../login/actions';

export default function RegisterPage() {
  return (
    <AuthShell title="Crea tu cuenta" lead="Primero tu cuenta; en el siguiente paso registras tu negocio.">
      <ActionForm action={signUp} submit="Crear cuenta" pending="Creando…">
        <Field label="Tu nombre">
          <input className="field" name="fullName" autoComplete="name" required minLength={2} maxLength={80} />
        </Field>
        <Field label="Correo">
          <input className="field" type="email" name="email" autoComplete="email" inputMode="email" required />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <input className="field" type="password" name="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </ActionForm>
      <p className="mt-8 text-ink-soft">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="font-semibold text-polish underline underline-offset-4">
          Inicia sesión
        </Link>
      </p>
    </AuthShell>
  );
}
