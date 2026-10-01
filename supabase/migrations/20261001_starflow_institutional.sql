-- StarFlow institutional foundation
-- Paste once into the Supabase SQL editor (idempotent).
-- Do NOT run from this repo unless the database is local.
--
-- Covers: orgs/memberships/invites, property+lease unification,
-- lease accounting inputs, alert de-dupe, additive RLS.
-- Existing live column names are preserved; this only ADDS columns/tables.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.org_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.organization_members
  WHERE org_id = p_org_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_write_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'member')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.lookup_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_user_id_by_email(text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_id_by_email(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_org(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_id_idx
  ON public.organization_members (user_id);

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

-- ---------------------------------------------------------------------------
-- Existing tables: additive columns (never rename live columns)
-- ---------------------------------------------------------------------------

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id),
  ADD COLUMN IF NOT EXISTS address text;

CREATE INDEX IF NOT EXISTS properties_organization_id_idx
  ON public.properties (organization_id);

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS incremental_borrowing_rate numeric,
  ADD COLUMN IF NOT EXISTS initial_direct_costs numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepaid_rent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_incentives numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accounting_presentation text DEFAULT 'finance',
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.leases
    ADD CONSTRAINT leases_accounting_presentation_check
    CHECK (
      accounting_presentation IS NULL
      OR accounting_presentation IN ('finance', 'operating')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.lease_abstracts
  ADD COLUMN IF NOT EXISTS lease_id uuid REFERENCES public.leases (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id),
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS lease_abstracts_lease_id_idx
  ON public.lease_abstracts (lease_id);

CREATE INDEX IF NOT EXISTS lease_abstracts_organization_id_idx
  ON public.lease_abstracts (organization_id);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id);

CREATE INDEX IF NOT EXISTS subscriptions_organization_id_idx
  ON public.subscriptions (organization_id);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id);

CREATE INDEX IF NOT EXISTS audit_logs_organization_id_idx
  ON public.audit_logs (organization_id);

ALTER TABLE public.notice_windows
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS notice_days integer;

CREATE TABLE IF NOT EXISTS public.alert_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE,
  lease_id uuid,
  abstract_id uuid,
  alert_type text NOT NULL,
  threshold_days integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_dispatches_dedupe_idx
  ON public.alert_dispatches (
    organization_id,
    COALESCE(lease_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(abstract_id, '00000000-0000-0000-0000-000000000000'::uuid),
    alert_type,
    threshold_days
  );

-- ---------------------------------------------------------------------------
-- Personal org bootstrap (first login / first membership)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_personal_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT om.org_id
    INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  INSERT INTO public.organizations (name, created_by)
  VALUES ('Personal workspace', v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  UPDATE public.properties
     SET organization_id = v_org_id
   WHERE user_id = v_user_id
     AND organization_id IS NULL;

  UPDATE public.lease_abstracts
     SET organization_id = v_org_id
   WHERE user_id = v_user_id
     AND organization_id IS NULL;

  UPDATE public.subscriptions
     SET organization_id = v_org_id
   WHERE user_id = v_user_id
     AND organization_id IS NULL;

  UPDATE public.audit_logs
     SET organization_id = v_org_id
   WHERE user_id = v_user_id
     AND organization_id IS NULL;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_personal_organization() TO authenticated;

-- ---------------------------------------------------------------------------
-- Accept pending invites for the current user's email
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_pending_org_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.organization_members (org_id, user_id, role)
  SELECT i.org_id, v_user_id, i.role
  FROM public.organization_invites i
  WHERE lower(i.email) = lower(v_email)
  ON CONFLICT (org_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.organization_invites
  WHERE lower(email) = lower(v_email);

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_pending_org_invites() TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: one personal org per existing property/abstract owner
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_org_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id
    FROM (
      SELECT user_id FROM public.properties WHERE user_id IS NOT NULL
      UNION
      SELECT user_id FROM public.lease_abstracts WHERE user_id IS NOT NULL
      UNION
      SELECT user_id FROM public.subscriptions WHERE user_id IS NOT NULL
    ) owners
  LOOP
    SELECT om.org_id
      INTO v_org_id
    FROM public.organization_members om
    WHERE om.user_id = r.user_id
    ORDER BY om.created_at ASC
    LIMIT 1;

    IF v_org_id IS NULL THEN
      INSERT INTO public.organizations (name, created_by)
      VALUES ('Personal workspace', r.user_id)
      RETURNING id INTO v_org_id;

      INSERT INTO public.organization_members (org_id, user_id, role)
      VALUES (v_org_id, r.user_id, 'owner')
      ON CONFLICT (org_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.properties
       SET organization_id = v_org_id
     WHERE user_id = r.user_id
       AND organization_id IS NULL;

    UPDATE public.lease_abstracts
       SET organization_id = v_org_id
     WHERE user_id = r.user_id
       AND organization_id IS NULL;

    UPDATE public.subscriptions
       SET organization_id = v_org_id
     WHERE user_id = r.user_id
       AND organization_id IS NULL;

    UPDATE public.audit_logs
       SET organization_id = v_org_id
     WHERE user_id = r.user_id
       AND organization_id IS NULL;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS (additive: existing user_id policies keep working)
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_abstracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_cam_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_risk_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT USING (public.is_org_member(id) OR created_by = auth.uid());

DROP POLICY IF EXISTS organizations_insert ON public.organizations;
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE USING (public.can_manage_org(id));

DROP POLICY IF EXISTS organization_members_select ON public.organization_members;
CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT USING (user_id = auth.uid() OR public.is_org_member(org_id));

DROP POLICY IF EXISTS organization_members_insert ON public.organization_members;
CREATE POLICY organization_members_insert ON public.organization_members
  FOR INSERT WITH CHECK (
    public.can_manage_org(org_id)
    OR (user_id = auth.uid() AND role = 'owner')
  );

DROP POLICY IF EXISTS organization_members_update ON public.organization_members;
CREATE POLICY organization_members_update ON public.organization_members
  FOR UPDATE USING (public.can_manage_org(org_id));

DROP POLICY IF EXISTS organization_members_delete ON public.organization_members;
CREATE POLICY organization_members_delete ON public.organization_members
  FOR DELETE USING (public.can_manage_org(org_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS organization_invites_select ON public.organization_invites;
CREATE POLICY organization_invites_select ON public.organization_invites
  FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS organization_invites_insert ON public.organization_invites;
CREATE POLICY organization_invites_insert ON public.organization_invites
  FOR INSERT WITH CHECK (public.can_manage_org(org_id));

DROP POLICY IF EXISTS organization_invites_delete ON public.organization_invites;
CREATE POLICY organization_invites_delete ON public.organization_invites
  FOR DELETE USING (public.can_manage_org(org_id));

DROP POLICY IF EXISTS properties_select_org ON public.properties;
CREATE POLICY properties_select_org ON public.properties
  FOR SELECT USING (
    (organization_id IS NOT NULL AND public.is_org_member(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS properties_insert_org ON public.properties;
CREATE POLICY properties_insert_org ON public.properties
  FOR INSERT WITH CHECK (
    (organization_id IS NOT NULL AND public.can_write_org(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS properties_update_org ON public.properties;
CREATE POLICY properties_update_org ON public.properties
  FOR UPDATE USING (
    (organization_id IS NOT NULL AND public.can_write_org(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS leases_select_org ON public.leases;
CREATE POLICY leases_select_org ON public.leases
  FOR SELECT USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE (organization_id IS NOT NULL AND public.is_org_member(organization_id))
         OR user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS leases_insert_org ON public.leases;
CREATE POLICY leases_insert_org ON public.leases
  FOR INSERT WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties
      WHERE (organization_id IS NOT NULL AND public.can_write_org(organization_id))
         OR user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS leases_update_org ON public.leases;
CREATE POLICY leases_update_org ON public.leases
  FOR UPDATE USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE (organization_id IS NOT NULL AND public.can_write_org(organization_id))
         OR user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS lease_abstracts_select_org ON public.lease_abstracts;
CREATE POLICY lease_abstracts_select_org ON public.lease_abstracts
  FOR SELECT USING (
    (organization_id IS NOT NULL AND public.is_org_member(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS lease_abstracts_insert_org ON public.lease_abstracts;
CREATE POLICY lease_abstracts_insert_org ON public.lease_abstracts
  FOR INSERT WITH CHECK (
    (organization_id IS NOT NULL AND public.can_write_org(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS lease_abstracts_update_org ON public.lease_abstracts;
CREATE POLICY lease_abstracts_update_org ON public.lease_abstracts
  FOR UPDATE USING (
    (organization_id IS NOT NULL AND public.can_write_org(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS notice_windows_select_org ON public.notice_windows;
CREATE POLICY notice_windows_select_org ON public.notice_windows
  FOR SELECT USING (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS notice_windows_insert_org ON public.notice_windows;
CREATE POLICY notice_windows_insert_org ON public.notice_windows
  FOR INSERT WITH CHECK (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS notice_windows_update_org ON public.notice_windows;
CREATE POLICY notice_windows_update_org ON public.notice_windows
  FOR UPDATE USING (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS operating_expenses_select_org ON public.operating_expenses;
CREATE POLICY operating_expenses_select_org ON public.operating_expenses
  FOR SELECT USING (
    property_id IN (SELECT id FROM public.properties)
  );

DROP POLICY IF EXISTS operating_expenses_insert_org ON public.operating_expenses;
CREATE POLICY operating_expenses_insert_org ON public.operating_expenses
  FOR INSERT WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties
      WHERE (organization_id IS NOT NULL AND public.can_write_org(organization_id))
         OR user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tenant_cam_select_org ON public.tenant_cam_allocations;
CREATE POLICY tenant_cam_select_org ON public.tenant_cam_allocations
  FOR SELECT USING (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS tenant_cam_insert_org ON public.tenant_cam_allocations;
CREATE POLICY tenant_cam_insert_org ON public.tenant_cam_allocations
  FOR INSERT WITH CHECK (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS audit_logs_select_org ON public.audit_logs;
CREATE POLICY audit_logs_select_org ON public.audit_logs
  FOR SELECT USING (
    (organization_id IS NOT NULL AND public.is_org_member(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS audit_logs_insert_org ON public.audit_logs;
CREATE POLICY audit_logs_insert_org ON public.audit_logs
  FOR INSERT WITH CHECK (
    (organization_id IS NOT NULL AND public.is_org_member(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS subscriptions_select_org ON public.subscriptions;
CREATE POLICY subscriptions_select_org ON public.subscriptions
  FOR SELECT USING (
    (organization_id IS NOT NULL AND public.is_org_member(organization_id))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS telemetry_select_org ON public.tenant_risk_telemetry;
CREATE POLICY telemetry_select_org ON public.tenant_risk_telemetry
  FOR SELECT USING (
    lease_id IN (SELECT id FROM public.leases)
  );

DROP POLICY IF EXISTS alert_dispatches_select_org ON public.alert_dispatches;
CREATE POLICY alert_dispatches_select_org ON public.alert_dispatches
  FOR SELECT USING (
    organization_id IS NOT NULL AND public.is_org_member(organization_id)
  );

-- Service role (cron / webhooks) bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- Backfill helper (also implemented in TypeScript: lib/lease/hydrate.ts)
-- For each abstract with null lease_id, the app parses abstract_data and
-- upserts properties + leases. Optional SQL sketch if you prefer a one-off:
--
--   -- Run after the TypeScript backfill, or skip this block.
--   -- Structured numbers/dates live in jsonb and are safer to parse in app code.
-- ---------------------------------------------------------------------------
