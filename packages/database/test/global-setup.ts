import { join } from 'node:path';
import { Client } from 'pg';
import { applyMigrations } from '../src/apply-migrations';
import { ADMIN_URL, TEST_DB, TEST_URL } from './helpers';

/** Crea una base de pruebas vacia y le aplica todas las migraciones. */
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = new Client({ connectionString: TEST_URL });
  await db.connect();
  await db.query('SET client_min_messages = warning');
  await applyMigrations(db, join(__dirname, '..', 'prisma', 'migrations'));
  await db.end();
}
