-- Seguridad e integridad que Prisma no modela.
-- 1. Rol de aplicacion sin permiso de saltarse RLS
-- 2. Row-Level Security por empresa en toda tabla con tenant_id
-- 3. Disparadores que impiden referencias entre empresas
-- 4. Restricciones de exclusion (doble reserva, caja, suscripcion)
-- 5. Estados de cita y de canje
-- 6. Ledger y auditoria de solo insercion; saldos derivados del ledger
-- 7. Reglas de integridad varias

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS app;

-- ───────────────────────── 1. Rol de aplicacion ─────────────────────────
-- El backend abre cada transaccion de empresa con:
--   SET LOCAL ROLE app_rls;  SELECT set_config('app.tenant_id', '<uuid>', true);
-- app_rls no puede saltarse RLS aunque el usuario de conexion si pueda.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rls') THEN
    CREATE ROLE app_rls NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT app_rls TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public, app TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls;

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON public._prisma_migrations FROM app_rls;
  END IF;
END $$;

-- Tablas globales: la empresa solo lee catalogos; no crea usuarios ni cuentas.
REVOKE INSERT, UPDATE, DELETE ON permissions, subscription_plans, users, customer_accounts, tenants FROM app_rls;
GRANT UPDATE ON tenants TO app_rls;
-- La suscripcion y su facturacion las gestiona la plataforma, no la empresa.
REVOKE INSERT, UPDATE, DELETE ON subscriptions, subscription_invoices FROM app_rls;
-- Solo insercion.
REVOKE UPDATE, DELETE ON loyalty_points_ledger, audit_logs FROM app_rls;
-- Los saldos de la tarjeta solo los mueve el disparador del ledger.
REVOKE UPDATE ON loyalty_cards FROM app_rls;
GRANT UPDATE (status, updated_at) ON loyalty_cards TO app_rls;

-- ───────────────────────── 2. Row-Level Security ─────────────────────────

CREATE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app.forbid_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tenant_id no se puede cambiar (%)', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

-- Activa RLS en toda tabla publica con columna tenant_id. Se vuelve a llamar
-- en cada migracion que cree tablas nuevas.
CREATE FUNCTION app.enable_tenant_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS forbid_tenant_change ON public.%I', t);
    EXECUTE format('CREATE TRIGGER forbid_tenant_change BEFORE UPDATE OF tenant_id ON public.%I FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) EXECUTE FUNCTION app.forbid_tenant_change()', t);
  END LOOP;
END $$;

SELECT app.enable_tenant_rls();

-- La propia empresa.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());

-- Usuarios: una empresa solo ve a sus miembros.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_members_only ON users FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = users.id AND m.tenant_id = app.current_tenant_id()));

-- Cuentas globales de clientes: solo las enlazadas a un cliente de la empresa.
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_customers_only ON customer_accounts FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers c WHERE c.account_id = customer_accounts.id AND c.tenant_id = app.current_tenant_id()));

-- ─────────────── 3. Sin referencias entre empresas ───────────────
-- Por cada clave foranea entre dos tablas con tenant_id, un disparador exige
-- que la fila referida sea de la misma empresa.

CREATE FUNCTION app.tenant_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ref_id uuid;
  ref_tenant uuid;
BEGIN
  ref_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT tenant_id FROM public.%I WHERE id = $1', TG_ARGV[0]) INTO ref_tenant USING ref_id;
  IF ref_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'referencia entre empresas: %.% -> %', TG_TABLE_NAME, TG_ARGV[1], TG_ARGV[0]
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.install_tenant_guards() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname, child.relname AS child_table, parent.relname AS parent_table, att.attname AS fk_column
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
      AND parent.relname <> 'tenants' AND att.attname <> 'tenant_id'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = child.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = parent.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tg_' || left(r.conname, 60), r.child_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION app.tenant_guard(%L, %L)',
      'tg_' || left(r.conname, 60), r.fk_column, r.child_table, r.parent_table, r.fk_column);
  END LOOP;
END $$;

SELECT app.install_tenant_guards();

-- ─────────────────── 4. Restricciones de exclusion ───────────────────

-- Un profesional no puede tener dos servicios activos que se solapen.
ALTER TABLE appointment_services
  ADD CONSTRAINT appointment_services_times_check
    CHECK (ends_at > starts_at AND occupied_start <= starts_at AND occupied_end >= ends_at),
  ADD CONSTRAINT appointment_services_no_double_booking
    EXCLUDE USING gist (
      tenant_id WITH =,
      employee_id WITH =,
      tstzrange(occupied_start, occupied_end, '[)') WITH &&
    ) WHERE (active);

-- Un recurso fisico (silla, cabina) no puede estar ocupado dos veces.
ALTER TABLE appointment_resources
  ADD CONSTRAINT appointment_resources_times_check CHECK (occupied_end > occupied_start),
  ADD CONSTRAINT appointment_resources_no_double_booking
    EXCLUDE USING gist (
      tenant_id WITH =,
      resource_id WITH =,
      tstzrange(occupied_start, occupied_end, '[)') WITH &&
    ) WHERE (active);

-- Una sola caja abierta por sucursal.
ALTER TABLE cash_sessions
  ADD CONSTRAINT cash_sessions_one_open_per_branch
    EXCLUDE USING gist (branch_id WITH =) WHERE (closed_at IS NULL);

-- Una sola suscripcion vigente por empresa.
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_one_live_per_tenant
    EXCLUDE USING gist (tenant_id WITH =) WHERE (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE'));

-- Un solo precio por combinacion servicio / profesional / sucursal (nulos incluidos).
ALTER TABLE service_prices
  ADD CONSTRAINT service_prices_one_per_scope
    EXCLUDE USING gist (
      service_id WITH =,
      (coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
      (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =
    );

-- ─────────────────── 5. Estados de cita y de canje ───────────────────

CREATE FUNCTION app.check_appointment_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (OLD.status = 'PENDING'     AND NEW.status IN ('CONFIRMED', 'CANCELLED')) OR
    (OLD.status = 'CONFIRMED'   AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'NO_SHOW')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'transicion de cita no permitida: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER appointment_transition BEFORE UPDATE OF status ON appointments
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app.check_appointment_transition();

-- Una cita cancelada o con inasistencia libera el horario y los recursos.
CREATE FUNCTION app.sync_appointment_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE is_active boolean := NEW.status NOT IN ('CANCELLED', 'NO_SHOW');
BEGIN
  UPDATE appointment_services SET active = is_active WHERE appointment_id = NEW.id AND active IS DISTINCT FROM is_active;
  UPDATE appointment_resources SET active = is_active WHERE appointment_id = NEW.id AND active IS DISTINCT FROM is_active;
  RETURN NULL;
END $$;

CREATE TRIGGER appointment_sync_active AFTER UPDATE OF status ON appointments
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app.sync_appointment_active();

-- Al insertar una linea, "active" se toma del estado de la cita, no del cliente.
CREATE FUNCTION app.set_line_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT a.status NOT IN ('CANCELLED', 'NO_SHOW') INTO NEW.active FROM appointments a WHERE a.id = NEW.appointment_id;
  RETURN NEW;
END $$;

CREATE TRIGGER appointment_services_set_active BEFORE INSERT ON appointment_services
  FOR EACH ROW EXECUTE FUNCTION app.set_line_active();
CREATE TRIGGER appointment_resources_set_active BEFORE INSERT ON appointment_resources
  FOR EACH ROW EXECUTE FUNCTION app.set_line_active();

ALTER TABLE appointments ADD CONSTRAINT appointments_times_check CHECK (ends_at > starts_at);

-- Un canje usado, cancelado o vencido es definitivo: no se puede usar dos veces.
CREATE FUNCTION app.check_redemption_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'USED', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'APPROVED'  AND NEW.status IN ('USED', 'CANCELLED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'transicion de canje no permitida: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER redemption_transition BEFORE UPDATE OF status ON reward_redemptions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app.check_redemption_transition();

-- ─────────────── 6. Ledger y auditoria de solo insercion ───────────────

CREATE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es de solo insercion: corrija con un movimiento nuevo', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON loyalty_points_ledger
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON loyalty_points_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE loyalty_points_ledger
  ADD CONSTRAINT loyalty_points_ledger_nonzero_check CHECK (points_delta <> 0 OR stamps_delta <> 0),
  ADD CONSTRAINT loyalty_points_ledger_reversal_check CHECK ((type = 'REVERSAL') = (reverses_id IS NOT NULL));

-- Cada movimiento actualiza el saldo en cache de su tarjeta en la misma
-- transaccion. Nadie mas puede escribir esos saldos.
CREATE FUNCTION app.apply_ledger_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE card loyalty_cards%ROWTYPE;
BEGIN
  SELECT * INTO card FROM loyalty_cards WHERE id = NEW.card_id FOR UPDATE;
  IF card.customer_id IS DISTINCT FROM NEW.customer_id OR card.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'el movimiento no corresponde al cliente de la tarjeta' USING ERRCODE = '23514';
  END IF;
  IF card.stamps_balance + NEW.stamps_delta < 0 THEN
    RAISE EXCEPTION 'saldo de sellos insuficiente' USING ERRCODE = '23514';
  END IF;
  -- Los puntos si pueden quedar negativos tras una reversion (decision 6);
  -- una redencion nunca puede dejarlos por debajo de cero.
  IF NEW.type = 'REDEMPTION' AND card.points_balance + NEW.points_delta < 0 THEN
    RAISE EXCEPTION 'saldo de puntos insuficiente' USING ERRCODE = '23514';
  END IF;
  UPDATE loyalty_cards
     SET points_balance = points_balance + NEW.points_delta,
         stamps_balance = stamps_balance + NEW.stamps_delta,
         updated_at = now()
   WHERE id = NEW.card_id;
  RETURN NEW;
END $$;

CREATE TRIGGER ledger_apply AFTER INSERT ON loyalty_points_ledger
  FOR EACH ROW EXECUTE FUNCTION app.apply_ledger_entry();

-- Verificacion: saldo en cache contra la suma del ledger. Debe devolver cero filas.
CREATE VIEW app.loyalty_balance_drift AS
  SELECT c.id AS card_id, c.tenant_id, c.points_balance, c.stamps_balance,
         coalesce(sum(l.points_delta), 0) AS ledger_points, coalesce(sum(l.stamps_delta), 0) AS ledger_stamps
  FROM loyalty_cards c LEFT JOIN loyalty_points_ledger l ON l.card_id = c.id
  GROUP BY c.id
  HAVING c.points_balance <> coalesce(sum(l.points_delta), 0) OR c.stamps_balance <> coalesce(sum(l.stamps_delta), 0);

-- ─────────────────── 7. Reglas de integridad varias ───────────────────

ALTER TABLE services
  ADD CONSTRAINT services_values_check
    CHECK (duration_minutes > 0 AND prep_minutes >= 0 AND cleanup_minutes >= 0 AND price >= 0 AND deposit_amount >= 0);
ALTER TABLE employee_schedules
  ADD CONSTRAINT employee_schedules_values_check CHECK (weekday BETWEEN 0 AND 6 AND end_time > start_time);
ALTER TABLE time_blocks ADD CONSTRAINT time_blocks_times_check CHECK (ends_at > starts_at);
ALTER TABLE employees ADD CONSTRAINT employees_commission_check CHECK (commission_percent BETWEEN 0 AND 100);
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_check CHECK (amount <> 0 AND (kind = 'REFUND') = (amount < 0)),
  ADD CONSTRAINT payments_refund_check CHECK ((kind = 'REFUND') = (refund_of_id IS NOT NULL));

-- Un pago aprobado no se edita; solo puede anularse. Los reembolsos son filas nuevas.
CREATE FUNCTION app.protect_approved_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'VOIDED') AND (
       NEW.amount <> OLD.amount OR NEW.kind <> OLD.kind OR NEW.method <> OLD.method
       OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR (OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED', 'VOIDED'))
       OR (OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED')) THEN
    RAISE EXCEPTION 'un pago aprobado no se modifica: registre un reembolso' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_protect_approved BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.protect_approved_payment();
