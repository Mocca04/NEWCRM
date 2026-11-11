import { HttpException, HttpStatus } from '@nestjs/common';
import { Tx } from '@newcrm/database';

export interface LivePlan {
  name: string;
  maxEmployees: number | null;
  maxBranches: number | null;
  features: Record<string, unknown>;
}

/** Plan de la suscripción vigente de la empresa en contexto. Sin suscripción vigente responde 402. */
export async function livePlan(tx: Tx): Promise<LivePlan> {
  const subscription = await tx.subscription.findFirst({
    where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
    select: { plan: { select: { name: true, maxEmployees: true, maxBranches: true, features: true } } },
  });
  if (!subscription) throw new HttpException('La empresa no tiene una suscripción vigente', HttpStatus.PAYMENT_REQUIRED);
  return subscription.plan as LivePlan;
}

export const planLimitReached = (message: string) => new HttpException(message, HttpStatus.PAYMENT_REQUIRED);
