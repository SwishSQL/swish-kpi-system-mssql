import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// SQL Server has no Prisma Json type, so the values are stored as JSON text.
export async function logAudit(client: DbClient, entry: AuditEntry) {
  await client.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValues: entry.oldValues === undefined ? null : JSON.stringify(entry.oldValues),
      newValues: entry.newValues === undefined ? null : JSON.stringify(entry.newValues),
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

/** Parses a stored JSON-text column back to the object the writer was given. */
export function parseJsonColumn(value: string | null): unknown {
  if (value === null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
