import { Prisma, Tx } from '@newcrm/database';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

const json = (value: unknown) => (value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue));

/** Registra una acción sensible en la misma transacción que el cambio. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
    },
  });
}
