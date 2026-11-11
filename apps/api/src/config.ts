import 'dotenv/config';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** URL del proyecto de Supabase, p. ej. https://xxxx.supabase.co */
  supabaseUrl: string;
  /** Solo para proyectos antiguos de Supabase que firman con HS256. */
  supabaseJwtSecret?: string;
  corsOrigins: string[];
  defaultTrialDays: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Falta la variable de entorno ${name}`);
    return value;
  };
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: required('DATABASE_URL'),
    supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET || undefined,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    defaultTrialDays: Number(env.DEFAULT_TRIAL_DAYS ?? 14),
  };
}
