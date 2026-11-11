'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, rememberTenant, requireWorkspace } from '@/lib/api';
import { failure, text, type FormState } from '@/lib/form';

export async function createTenant(_: FormState, form: FormData): Promise<FormState> {
  let tenantId: string;
  try {
    const tenant = await api<{ id: string }>('/tenants', {
      method: 'POST',
      body: { tradeName: text(form, 'tradeName'), slug: text(form, 'slug')?.toLowerCase(), city: text(form, 'city'), phone: text(form, 'phone') },
    });
    tenantId = tenant.id;
  } catch (error) {
    return failure(error);
  }
  await rememberTenant(tenantId);
  redirect('/panel');
}

export async function switchTenant(form: FormData): Promise<void> {
  const tenantId = text(form, 'tenantId');
  if (tenantId) await rememberTenant(tenantId);
  redirect('/panel');
}

export async function updateTenant(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api('/tenant', {
      method: 'PATCH',
      tenantId: active.tenant.id,
      body: {
        tradeName: text(form, 'tradeName'), legalName: text(form, 'legalName'), nit: text(form, 'nit'),
        email: text(form, 'email'), phone: text(form, 'phone'), city: text(form, 'city'), address: text(form, 'address'),
      },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel', 'layout');
  return { ok: 'Datos guardados.' };
}

export async function createBranch(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api('/branches', {
      method: 'POST',
      tenantId: active.tenant.id,
      body: { name: text(form, 'name'), city: text(form, 'city'), address: text(form, 'address'), phone: text(form, 'phone') },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/sucursales');
  return { ok: 'Sucursal agregada.' };
}

export async function updateBranch(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api(`/branches/${text(form, 'id')}`, {
      method: 'PATCH',
      tenantId: active.tenant.id,
      body: { name: text(form, 'name'), city: text(form, 'city'), address: text(form, 'address'), phone: text(form, 'phone') },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/sucursales');
  return { ok: 'Cambios guardados.' };
}

export async function setBranchActive(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api(`/branches/${text(form, 'id')}/${form.get('activate') === 'true' ? 'activate' : 'deactivate'}`, { method: 'POST', tenantId: active.tenant.id });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/sucursales');
  return {};
}

export async function inviteMember(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const email = text(form, 'email');
  try {
    await api('/members', { method: 'POST', tenantId: active.tenant.id, body: { email, fullName: text(form, 'fullName'), roleId: text(form, 'roleId') } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/equipo');
  return { ok: `${email} ya tiene acceso. Entra cuando cree su cuenta con ese correo.` };
}

export async function updateMember(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const body: Record<string, unknown> = {};
  if (text(form, 'roleId')) body.roleId = text(form, 'roleId');
  if (form.has('isActive')) body.isActive = form.get('isActive') === 'true';
  try {
    await api(`/members/${text(form, 'id')}`, { method: 'PATCH', tenantId: active.tenant.id, body });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/equipo');
  return 'roleId' in body ? { ok: 'Rol actualizado.' } : {};
}
