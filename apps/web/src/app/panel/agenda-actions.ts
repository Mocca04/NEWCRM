'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, requireWorkspace } from '@/lib/api';
import { failure, text, type FormState } from '@/lib/form';
import { isDate, localDate, zonedInstant } from '@/lib/time';

const ACTIONS = ['confirm', 'start', 'complete', 'no-show'] as const;

export async function createAppointment(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const walkIn = form.get('walkIn') === 'true';
  const startsAt = text(form, 'startsAt');
  if (!walkIn && !startsAt) return { error: 'Elige una hora para la cita.' };
  const employeeId = text(form, 'employeeId');
  const serviceIds = form.getAll('serviceIds').filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (serviceIds.length === 0) return { error: 'Elige al menos un servicio.' };
  const phone = text(form, 'phone')?.replace(/[\s()-]/g, '');
  const times = Number(text(form, 'times') ?? 1);
  const everyWeeks = Number(text(form, 'everyWeeks') ?? 0);
  const timezone = text(form, 'timezone') ?? 'America/Bogota';

  let created: { startsAt: string; series?: { created: number; conflicts: unknown[] } };
  try {
    created = await api('/appointments', {
      method: 'POST',
      tenantId: active.tenant.id,
      idempotencyKey: text(form, 'requestId'),
      body: {
        branchId: text(form, 'branchId'),
        ...(walkIn ? { walkIn: true } : { startsAt }),
        services: serviceIds.map((serviceId) => ({ serviceId, ...(employeeId ? { employeeId } : {}) })),
        customer: { fullName: text(form, 'fullName'), phone },
        notes: text(form, 'notes'),
        ...(everyWeeks > 0 && times > 1 ? { repeat: { everyWeeks, times } } : {}),
      },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/agenda');
  const skipped = created.series?.conflicts.length ?? 0;
  redirect(`/panel/agenda?fecha=${localDate(created.startsAt, timezone)}${skipped ? `&aviso=${created.series!.created}-${skipped}` : ''}`);
}

export async function changeStatus(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const action = text(form, 'action') as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) return { error: 'Acción desconocida.' };
  try {
    await api(`/appointments/${text(form, 'id')}/${action}`, { method: 'POST', tenantId: active.tenant.id });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/agenda');
  return {};
}

export async function cancelAppointment(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  try {
    await api(`/appointments/${text(form, 'id')}/cancel`, { method: 'POST', tenantId: active.tenant.id, body: { reason: text(form, 'reason') } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/agenda');
  return {};
}

export async function moveAppointment(_: FormState, form: FormData): Promise<FormState> {
  const { active } = await requireWorkspace();
  const date = text(form, 'date');
  const time = text(form, 'time');
  if (!isDate(date) || !time || !/^\d{2}:\d{2}$/.test(time)) return { error: 'Elige el nuevo día y la nueva hora.' };
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const startsAt = zonedInstant(date, minutes, text(form, 'timezone') ?? 'America/Bogota').toISOString();
  try {
    await api(`/appointments/${text(form, 'id')}`, { method: 'PATCH', tenantId: active.tenant.id, body: { startsAt } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/panel/agenda');
  redirect(`/panel/agenda?fecha=${date}`);
}
