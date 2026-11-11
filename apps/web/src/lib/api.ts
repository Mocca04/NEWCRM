import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Membership {
  tenant: { id: string; tradeName: string; slug: string; status: string; logoUrl: string | null };
  role: { id: string; name: string };
  permissions: string[];
  branchIds: string[];
}

export interface Me {
  user: { id: string; email: string; fullName: string };
  memberships: Membership[];
}

/** Llama a la API con la sesión del usuario. Sin sesión valida, lleva a iniciar sesión. */
export async function api<T>(path: string, options: { method?: string; body?: unknown; tenantId?: string } = {}): Promise<T> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) redirect('/login');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.tenantId ? { 'X-Tenant-Id': options.tenantId } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(503, 'No se pudo conectar con el servidor. Intenta de nuevo en un momento.');
  }
  if (response.status === 401) redirect('/login');
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message;
    throw new ApiError(response.status, message ?? 'Algo salió mal. Intenta de nuevo.');
  }
  return payload as T;
}

const TENANT_COOKIE = 'empresa';

/** Usuario, sus empresas y la empresa en la que está trabajando ahora. */
export async function getWorkspace(): Promise<{ me: Me; active: Membership | undefined }> {
  const me = await api<Me>('/me');
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const active = me.memberships.find((m) => m.tenant.id === chosen) ?? me.memberships[0];
  return { me, active };
}

/** Igual que getWorkspace, pero exige tener empresa: si no, lleva a crearla. */
export async function requireWorkspace(): Promise<{ me: Me; active: Membership }> {
  const { me, active } = await getWorkspace();
  if (!active) redirect('/panel/nueva-empresa');
  return { me, active };
}

export async function rememberTenant(tenantId: string): Promise<void> {
  (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
}

export const can = (membership: Membership, permission: string): boolean => membership.permissions.includes(permission);
