import Link from 'next/link';
import { ActionForm, Field } from '@/components/action-form';
import { AuthShell } from '@/components/auth-shell';
import { signIn } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const { aviso } = await searchParams;
  return (
    <AuthShell title="Entra a tu negocio" lead="Usa el correo con el que te registraste o con el que te invitaron.">
      {aviso === 'enlace' && (
        <p role="alert" className="mb-4 rounded-lg bg-warn-soft px-3.5 py-3 text-sm text-warn">
          El enlace ya se usó o venció. Inicia sesión o regístrate de nuevo.
        </p>
      )}
      <ActionForm action={signIn} submit="Iniciar sesión" pending="Entrando…">
        <Field label="Correo">
          <input className="field" type="email" name="email" autoComplete="email" inputMode="email" required />
        </Field>
        <Field label="Contraseña">
          <input className="field" type="password" name="password" autoComplete="current-password" required />
        </Field>
      </ActionForm>
      <p className="mt-8 text-ink-soft">
        ¿Tu negocio aún no está aquí?{' '}
        <Link href="/registro" className="font-semibold text-polish underline underline-offset-4">
          Crea tu cuenta
        </Link>
      </p>
    </AuthShell>
  );
}
