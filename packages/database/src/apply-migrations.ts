import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

/**
 * Aplica en orden todos los migration.sql sobre una base vacia.
 * Lo usan las pruebas para levantar una base limpia. En desarrollo y
 * produccion las migraciones se aplican con `prisma migrate deploy`.
 */
export async function applyMigrations(client: Client, migrationsDir: string): Promise<string[]> {
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await client.query(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
  }
  return names;
}
