import type { ReactNode } from 'react';

/** Marco de las pantallas de acceso: el formulario y, al lado, lo que el negocio va a poder hacer. */
export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex items-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-4xl font-bold">{title}</h1>
          <p className="mt-3 mb-8 text-ink-soft">{lead}</p>
          {children}
        </div>
      </section>
      <aside className="hidden bg-polish px-14 py-16 text-white lg:flex lg:flex-col lg:justify-end" aria-hidden="true">
        <p className="font-display text-[clamp(2.75rem,5vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight">
          La silla llena.
          <br />
          La agenda en orden.
          <br />
          El cliente que vuelve.
        </p>
        <p className="mt-8 max-w-md text-lg text-white/85">
          Reservas desde el celular, ficha de cada cliente y tarjeta de sellos para manicuristas, barberías, peluquerías y estilistas.
        </p>
      </aside>
    </main>
  );
}
