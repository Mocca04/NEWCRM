'use server';

import { revalidatePath } from 'next/cache';
import { api, requireWorkspace } from '@/lib/api';
import { failure, text, type FormState } from '@/lib/form';
import { toCents, WEEK } from '@/lib/format';

const ids = (form: FormData, name: string): string[] => form.getAll(name).filter((v): v is string => typeof v === 'string' && v.length > 0);
const int = (form: FormData, name: string): number | undefined => (text(form, name) === undefined ? undefined : Number(text(form, name)));

export async function loadTemplate(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  let created: number;
  try {
    ({ created } = await api<{ created: number }>('/catalog/templates', { method: 'POST', tenantId: active.tenant.id, body: { vertical: text(form, 'vertical') } }));
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/servicios');
  return { ok: created ? `Se agregaron ${created} servicios. Ponles precio para publicarlos.` : 'Esos servicios ya estaban en tu lista.' };
}

export async function createCategory(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api('/service-categories', { method: 'POST', tenantId: active.tenant.id, body: { name: text(form, 'name') } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/servicios');
  return { ok: 'Categoría agregada.' };
}

function serviceBody(form: FormData) {
  const price = toCents(text(form, 'price'));
  return {
    categoryId: text(form, 'categoryId'),
    name: text(form, 'name'),
    price,
    durationMinutes: int(form, 'durationMinutes'),
    prepMinutes: int(form, 'prepMinutes') ?? 0,
    cleanupMinutes: int(form, 'cleanupMinutes') ?? 0,
    depositAmount: toCents(text(form, 'depositAmount')) ?? 0,
  };
}

export async function createService(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const body = serviceBody(form);
  if (body.price === undefined || Number.isNaN(body.price)) return { error: 'Escribe el precio en pesos, solo números. Ejemplo: 25000' };
  try {
    await api('/services', { method: 'POST', tenantId: active.tenant.id, body: { ...body, isPublic: body.price > 0 } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/servicios');
  return { ok: `${body.name} agregado.` };
}

export async function updateService(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const body = serviceBody(form);
  if (body.price === undefined || Number.isNaN(body.price) || Number.isNaN(body.depositAmount)) return { error: 'Escribe los valores en pesos, solo números. Ejemplo: 25000' };
  const isPublic = form.get('isPublic') === 'on';
  if (isPublic && body.price === 0) return { error: 'Ponle precio al servicio antes de publicarlo.' };
  try {
    await api(`/services/${text(form, 'id')}`, { method: 'PATCH', tenantId: active.tenant.id, body: { ...body, isPublic, employeeIds: ids(form, 'employeeIds') } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/servicios');
  revalidatePath('/panel/profesionales');
  return { ok: 'Cambios guardados.' };
}

export async function deleteService(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api(`/services/${text(form, 'id')}`, { method: 'DELETE', tenantId: active.tenant.id });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/servicios');
  return {};
}

function employeeBody(form: FormData) {
  const commission = text(form, 'commissionPercent');
  return {
    fullName: text(form, 'fullName'),
    branchId: text(form, 'branchId'),
    commissionPercent: commission === undefined ? 0 : Number(commission.replace(',', '.')),
    specialties: (text(form, 'specialties') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    serviceIds: ids(form, 'serviceIds'),
  };
}

export async function createEmployee(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const body = employeeBody(form);
  try {
    await api('/employees', { method: 'POST', tenantId: active.tenant.id, body });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/profesionales');
  revalidatePath('/panel/servicios');
  return { ok: `${body.fullName} agregado. Ahora define su horario.` };
}

export async function updateEmployee(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const body = employeeBody(form);
  if (Number.isNaN(body.commissionPercent)) return { error: 'La comisión es un porcentaje entre 0 y 100.' };
  try {
    await api(`/employees/${text(form, 'id')}`, { method: 'PATCH', tenantId: active.tenant.id, body });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/profesionales');
  revalidatePath('/panel/servicios');
  return { ok: 'Cambios guardados.' };
}

export async function setEmployeeActive(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api(`/employees/${text(form, 'id')}/${form.get('activate') === 'true' ? 'activate' : 'deactivate'}`, { method: 'POST', tenantId: active.tenant.id });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/profesionales');
  return {};
}

export async function setSchedule(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const entries: { weekday: number; startTime: string; endTime: string }[] = [];
  for (const { weekday, name } of WEEK) {
    if (form.get(`d${weekday}-on`) !== 'on') continue;
    const [start, end, breakStart, breakEnd] = ['start', 'end', 'bstart', 'bend'].map((field) => text(form, `d${weekday}-${field}`));
    if (!start || !end) return { error: `Falta la hora de entrada o de salida del ${name.toLowerCase()}.` };
    if (Boolean(breakStart) !== Boolean(breakEnd)) return { error: `Completa las dos horas del descanso del ${name.toLowerCase()}, o deja ambas vacías.` };
    if (breakStart && breakEnd) {
      if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) return { error: `El descanso del ${name.toLowerCase()} debe quedar dentro del horario.` };
      entries.push({ weekday, startTime: start, endTime: breakStart }, { weekday, startTime: breakEnd, endTime: end });
    } else {
      entries.push({ weekday, startTime: start, endTime: end });
    }
  }
  try {
    await api(`/employees/${text(form, 'id')}/schedule`, { method: 'PUT', tenantId: active.tenant.id, body: { entries } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/profesionales');
  return { ok: entries.length ? 'Horario guardado.' : 'Horario guardado: no tiene días de trabajo.' };
}
