-- RLS hardening: org-scoped, role-aware policies for every app table.
--
-- Problems in 20261001_starflow_institutional.sql that this fixes:
--
--  1. organization_members_insert allowed `user_id = auth.uid() AND role =
--     'owner'` for ANY org_id, so any signed-in user could make themselves
--     owner of any workspace they knew the id of.
--  2. properties / lease_abstracts / audit_logs INSERT policies were
--     `<org check> OR user_id = auth.uid()`. The OR branch let a user insert
--     rows stamped with someone else's organization_id (cross-tenant write
--     / forged audit entries) and let demoted or removed members keep write
--     access to rows they created.
--  3. notice_windows / tenant_cam_allocations / operating_expenses writes
--     only required being able to SEE the parent row, so VIEWERS could write.
--  4. organization_invites had no UPDATE policy, so re-inviting an email
--     (an upsert) failed under RLS.
--  5. Policies that pre-date this repo (the base schema is not in version
--     control) are unknown and OR together with ours. They are dropped here
--     so only the policies below apply.
--
-- Roles: owner > admin > member > viewer.
--   read   : any member (is_org_member)
--   write  : owner / admin / member (can_write_org)
--   manage : owner / admin (can_manage_org)
-- Service role (webhook, cron, admin client) bypasses RLS by design.
--
-- Safe to re-run. Review "WHAT THIS DROPS" before applying to a database
-- that has hand-written policies you want to keep.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid)
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
      AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.org_has_no_members(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organization_members WHERE org_id = p_org_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_has_no_members(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- WHAT THIS DROPS: every existing policy on the app tables below.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organizations',
        'organization_members',
        'organization_invites',
        'properties',
        'leases',
        'lease_abstracts',
        'notice_windows',
        'operating_expenses',
        'tenant_cam_allocations',
        'audit_logs',
        'subscriptions',
        'alert_dispatches',
        'tenant_risk_telemetry'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;

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

-- The app is login-only: nothing is read or written as `anon`.
REVOKE ALL ON
  public.organizations,
  public.organization_members,
  public.organization_invites,
  public.properties,
  public.leases,
  public.lease_abstracts,
  public.notice_windows,
  public.operating_expenses,
  public.tenant_cam_allocations,
  public.audit_logs,
  public.subscriptions,
  public.alert_dispatches,
  public.tenant_risk_telemetry
FROM anon;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id) OR created_by = auth.uid());

CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.can_manage_org(id))
  WITH CHECK (public.can_manage_org(id));

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id));

-- Owners/admins add members (only owners may grant 'owner'). The ONLY
-- self-insert allowed is bootstrapping the first owner row of an
-- organization you created yourself that has no members yet.
CREATE POLICY organization_members_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.can_manage_org(org_id)
      AND (role <> 'owner' OR public.is_org_owner(org_id))
    )
    OR (
      user_id = auth.uid()
      AND role = 'owner'
      AND public.org_has_no_members(org_id)
      AND EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = org_id AND o.created_by = auth.uid()
      )
    )
  );

-- Admins cannot touch owner rows or promote anyone to owner.
CREATE POLICY organization_members_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (
    public.can_manage_org(org_id)
    AND (role <> 'owner' OR public.is_org_owner(org_id))
  )
  WITH CHECK (
    public.can_manage_org(org_id)
    AND (role <> 'owner' OR public.is_org_owner(org_id))
  );

CREATE POLICY organization_members_delete ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.can_manage_org(org_id)
      AND (role <> 'owner' OR public.is_org_owner(org_id))
    )
  );

-- ---------------------------------------------------------------------------
-- organization_invites
-- ---------------------------------------------------------------------------

CREATE POLICY organization_invites_select ON public.organization_invites
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY organization_invites_insert ON public.organization_invites
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_org(org_id));

CREATE POLICY organization_invites_update ON public.organization_invites
  FOR UPDATE TO authenticated
  USING (public.can_manage_org(org_id))
  WITH CHECK (public.can_manage_org(org_id));

CREATE POLICY organization_invites_delete ON public.organization_invites
  FOR DELETE TO authenticated
  USING (public.can_manage_org(org_id));

-- ---------------------------------------------------------------------------
-- properties
-- (Rows with a NULL organization_id are legacy; readable by their creator
-- only and not writable until backfilled into an organization.)
-- ---------------------------------------------------------------------------

CREATE POLICY properties_select ON public.properties
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(organization_id)
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

CREATE POLICY properties_insert ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_org(organization_id));

CREATE POLICY properties_update ON public.properties
  FOR UPDATE TO authenticated
  USING (public.can_write_org(organization_id))
  WITH CHECK (public.can_write_org(organization_id));

-- ---------------------------------------------------------------------------
-- leases (scoped through their property's organization)
-- ---------------------------------------------------------------------------

CREATE POLICY leases_select ON public.leases
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = leases.property_id
        AND public.is_org_member(p.organization_id)
    )
  );

CREATE POLICY leases_insert ON public.leases
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = leases.property_id
        AND public.can_write_org(p.organization_id)
    )
  );

CREATE POLICY leases_update ON public.leases
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = leases.property_id
        AND public.can_write_org(p.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = leases.property_id
        AND public.can_write_org(p.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- lease_abstracts
-- ---------------------------------------------------------------------------

CREATE POLICY lease_abstracts_select ON public.lease_abstracts
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(organization_id)
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

-- Rows must be attributed to the caller AND land in an org they can write.
CREATE POLICY lease_abstracts_insert ON public.lease_abstracts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_org(organization_id)
    AND user_id = auth.uid()
  );

-- A linked canonical lease must belong to the same organization.
CREATE POLICY lease_abstracts_update ON public.lease_abstracts
  FOR UPDATE TO authenticated
  USING (public.can_write_org(organization_id))
  WITH CHECK (
    public.can_write_org(organization_id)
    AND (
      lease_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.leases l
        JOIN public.properties p ON p.id = l.property_id
        WHERE l.id = lease_abstracts.lease_id
          AND p.organization_id = lease_abstracts.organization_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- notice_windows (scoped through lease -> property -> organization)
-- ---------------------------------------------------------------------------

CREATE POLICY notice_windows_select ON public.notice_windows
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = notice_windows.lease_id
        AND public.is_org_member(p.organization_id)
    )
  );

CREATE POLICY notice_windows_insert ON public.notice_windows
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = notice_windows.lease_id
        AND public.can_write_org(p.organization_id)
    )
  );

CREATE POLICY notice_windows_update ON public.notice_windows
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = notice_windows.lease_id
        AND public.can_write_org(p.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = notice_windows.lease_id
        AND public.can_write_org(p.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- operating_expenses (scoped through property)
-- ---------------------------------------------------------------------------

CREATE POLICY operating_expenses_select ON public.operating_expenses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = operating_expenses.property_id
        AND public.is_org_member(p.organization_id)
    )
  );

CREATE POLICY operating_expenses_insert ON public.operating_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = operating_expenses.property_id
        AND public.can_write_org(p.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- tenant_cam_allocations (scoped through lease -> property)
-- ---------------------------------------------------------------------------

CREATE POLICY tenant_cam_allocations_select ON public.tenant_cam_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = tenant_cam_allocations.lease_id
        AND public.is_org_member(p.organization_id)
    )
  );

CREATE POLICY tenant_cam_allocations_insert ON public.tenant_cam_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = tenant_cam_allocations.lease_id
        AND public.can_write_org(p.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- audit_logs: append-only (no UPDATE / DELETE policy). Entries must be
-- attributed to the caller and may only target an org they belong to.
-- ---------------------------------------------------------------------------

CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(organization_id)
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (organization_id IS NULL OR public.is_org_member(organization_id))
  );

-- ---------------------------------------------------------------------------
-- subscriptions: read-only for members. All writes come from the Stripe
-- webhook via the service role; there must be NO insert/update policy, or
-- a user could grant their own organization Pro.
-- ---------------------------------------------------------------------------

CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(organization_id)
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- alert_dispatches / tenant_risk_telemetry: read-only for members.
-- ---------------------------------------------------------------------------

CREATE POLICY alert_dispatches_select ON public.alert_dispatches
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY tenant_risk_telemetry_select ON public.tenant_risk_telemetry
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = tenant_risk_telemetry.lease_id
        AND public.is_org_member(p.organization_id)
    )
  );
