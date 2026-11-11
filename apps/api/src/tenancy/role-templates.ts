/** Roles que toda empresa recibe al crearse. La empresa puede ajustarlos después (salvo Propietario). */
export const OWNER_ROLE = 'Propietario';

export const ROLE_TEMPLATES: ReadonlyArray<{ name: string; permissions: 'ALL' | readonly string[]; except?: readonly string[] }> = [
  { name: OWNER_ROLE, permissions: 'ALL' },
  { name: 'Administrador', permissions: 'ALL', except: ['subscription.manage'] },
  {
    name: 'Recepcionista',
    permissions: ['appointments.read', 'appointments.manage', 'customers.read', 'customers.manage', 'payments.manage', 'cash.manage', 'rewards.validate'],
  },
  { name: 'Profesional', permissions: ['appointments.read.own', 'commissions.read.own'] },
];

/** Palabras que no pueden ser la dirección pública de un negocio. */
export const RESERVED_SLUGS = new Set(['api', 'admin', 'app', 'panel', 'login', 'registro', 'docs', 'public', 'static', 'assets', 'www', 'soporte', 'wallet', 'webhooks']);
