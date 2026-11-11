import { generateKeyPairSync, KeyObject, randomUUID, sign } from 'node:crypto';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { applyMigrations } from '@newcrm/database';
import { Client } from 'pg';
import request from 'supertest';
import { Jwk, SupabaseTokenVerifier, TOKEN_VERIFIER } from '../src/auth/token-verifier';
import { setupApp } from '../src/setup';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const TEST_DB = 'newcrm_api_test';
const ISSUER = 'https://proyecto-de-pruebas.supabase.co/auth/v1';

export const testUrl = (): string => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
};

/**
 * Emite tokens con el mismo formato que Supabase Auth (ES256), firmados con
 * una llave local. La API los valida con su verificador real; lo unico que
 * cambia en pruebas es de donde salen las llaves publicas.
 */
export class TestIdentityProvider {
  private readonly kid = randomUUID();
  private readonly privateKey: KeyObject;
  readonly jwks: Jwk[];

  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.jwks = [{ ...pair.publicKey.export({ format: 'jwk' }), kid: this.kid, alg: 'ES256' }];
  }

  token(email: string, overrides: Record<string, unknown> = {}, key: KeyObject = this.privateKey): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'ES256', typ: 'JWT', kid: this.kid });
    const payload = encode({
      iss: ISSUER, aud: 'authenticated', sub: `auth-${email}`, email, iat: now, exp: now + 3600,
      user_metadata: { email_verified: true, full_name: email.split('@')[0] },
      ...overrides,
    });
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  forgedToken(email: string): string {
    return this.token(email, {}, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey);
  }
}

export interface Harness {
  app: INestApplication;
  idp: TestIdentityProvider;
  db: Client;
  /** Cliente HTTP autenticado como `email`, opcionalmente dentro de una empresa. */
  as(email: string, tenantId?: string): {
    get(path: string): request.Test;
    post(path: string, body?: object): request.Test;
    patch(path: string, body?: object): request.Test;
    put(path: string, body?: object): request.Test;
  };
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = new Client({ connectionString: testUrl() });
  await db.connect();
  await db.query('SET client_min_messages = warning');
  await applyMigrations(db, join(__dirname, '..', '..', '..', 'packages', 'database', 'prisma', 'migrations'));

  process.env.DATABASE_URL = testUrl();
  process.env.SUPABASE_URL = 'https://proyecto-de-pruebas.supabase.co';
  const { AppModule } = await import('../src/app.module');

  const idp = new TestIdentityProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(new SupabaseTokenVerifier({ issuer: ISSUER, jwks: async () => idp.jwks }))
    .compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();

  const send = (method: 'get' | 'post' | 'patch' | 'put', email: string, tenantId: string | undefined, path: string, body?: object) => {
    let req = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${idp.token(email)}`);
    if (tenantId) req = req.set('X-Tenant-Id', tenantId);
    return body ? req.send(body) : req;
  };

  return {
    app,
    idp,
    db,
    as: (email, tenantId) => ({
      get: (path) => send('get', email, tenantId, path),
      post: (path, body) => send('post', email, tenantId, path, body ?? {}),
      patch: (path, body) => send('patch', email, tenantId, path, body ?? {}),
      put: (path, body) => send('put', email, tenantId, path, body ?? {}),
    }),
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
