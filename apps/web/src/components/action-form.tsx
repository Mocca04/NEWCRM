'use client';

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from 'react';
import type { FormState } from '@/lib/form';

/** Formulario ligado a una acción de servidor: muestra el resultado y bloquea el boton mientras envía. */
export function ActionForm({
  action,
  submit,
  pending = 'Guardando…',
  quiet = false,
  resetOnSuccess = false,
  className = 'space-y-4',
  children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: string;
  pending?: string;
  quiet?: boolean;
  /** Vaciar el formulario cuando la acción termina bien (formularios de "agregar"). */
  resetOnSuccess?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok) form.current?.reset();
  }, [resetOnSuccess, state]);
  return (
    <form
      ref={form}
      action={formAction}
      className={className}
      // Enviar a mano evita que React vacie el formulario al terminar: si la
      // acción falla, la persona no pierde lo que escribio.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="rounded-lg bg-blush px-3.5 py-3 text-sm text-polish-deep">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-lg bg-ok-soft px-3.5 py-3 text-sm text-ok">
          {state.ok}
        </p>
      )}
      <button type="submit" disabled={isPending} className={quiet ? 'btn-quiet' : 'btn w-full sm:w-auto'}>
        {isPending ? pending : submit}
      </button>
    </form>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}
