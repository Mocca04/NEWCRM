#!/usr/bin/env bash
# Levanta Supabase de pruebas, la API y la web contra una base limpia y
# ejecuta el recorrido en un navegador. Requiere PostgreSQL y Google Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
DB_URL="${ADMIN_URL%/*}/newcrm_web_e2e"
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54399 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=llave-de-pruebas
export NEXT_PUBLIC_SITE_URL=http://localhost:3112 API_URL=http://localhost:3111 NEXT_TELEMETRY_DISABLED=1

for port in 54399 3111 3112; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "El puerto $port esta ocupado: cierre el proceso que lo usa." >&2; exit 1; fi
done

psql "$ADMIN_URL" -q -c 'DROP DATABASE IF EXISTS newcrm_web_e2e WITH (FORCE)' -c 'CREATE DATABASE newcrm_web_e2e'
for migration in ../../packages/database/prisma/migrations/*/migration.sql; do
  PGOPTIONS='--client-min-messages=warning' psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$migration"
done

pids=()
# Cada servidor va en su propio grupo de procesos para poder cerrarlo completo al terminar.
trap 'for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done' EXIT
setsid node e2e/fake-supabase.mjs & pids+=($!)
DATABASE_URL="$DB_URL" SUPABASE_URL=http://localhost:54399 PORT=3111 CORS_ORIGINS=http://localhost:3112 \
  setsid pnpm --dir ../api start:dev >/tmp/e2e-api.log 2>&1 & pids+=($!)
[ -d .next ] && [ -z "${E2E_REBUILD:-}" ] || pnpm build >/dev/null
setsid pnpm start -p 3112 >/tmp/e2e-web.log 2>&1 & pids+=($!)

for url in http://localhost:3111/api/v1/health http://localhost:3112/login; do
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$url" && break || sleep 1; done
done
node e2e/flow.mjs
