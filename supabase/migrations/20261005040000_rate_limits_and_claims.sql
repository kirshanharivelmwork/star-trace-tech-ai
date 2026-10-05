-- Per-user / per-org rate limiting for LLM routes, and an atomic reservation
-- for the free-plan lease-abstract limit. Supabase only; no new vendor.
--
-- Both are SECURITY DEFINER functions that derive the caller from auth.uid()
-- and check org membership themselves, so the browser-held JWT can call
-- them but cannot spoof another user or org. The backing tables have RLS
-- enabled with NO policies and no table grants: they are reachable only
-- through these functions.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Rate limiting: fixed-window counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_window_start_idx
  ON public.rate_limit_counters (window_start);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;

-- Returns true if the request is allowed, false if the user or the org has
-- exceeded its limit for the current window. Denied requests still count.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_scope text,
  p_org_id uuid,
  p_window_seconds integer,
  p_user_limit integer,
  p_org_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_window timestamptz;
  v_hits integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_scope IS NULL OR length(p_scope) = 0 OR length(p_scope) > 32
     OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_user_limit < 1 OR p_org_limit < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit arguments';
  END IF;

  IF p_org_id IS NOT NULL AND NOT public.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_counters AS c (key, window_start, hits)
  VALUES ('user:' || v_user::text || ':' || p_scope, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = c.hits + 1
  RETURNING c.hits INTO v_hits;

  IF v_hits > p_user_limit THEN
    RETURN false;
  END IF;

  IF p_org_id IS NOT NULL THEN
    INSERT INTO public.rate_limit_counters AS c (key, window_start, hits)
    VALUES ('org:' || p_org_id::text || ':' || p_scope, v_window, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET hits = c.hits + 1
    RETURNING c.hits INTO v_hits;

    IF v_hits > p_org_limit THEN
      RETURN false;
    END IF;
  END IF;

  -- Opportunistic cleanup of old windows (~1% of calls).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters
    WHERE window_start < now() - interval '2 days';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, uuid, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, uuid, integer, integer, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Free-plan limit: atomic reservation of one lease analysis
--
-- The old check (count rows, then insert the result minutes later, after the
-- LLM finished) let N concurrent uploads all pass at count = limit - 1.
-- claim_lease_analysis() serialises per organization with an advisory lock
-- and counts saved abstracts PLUS in-flight claims.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lease_analysis_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lease_analysis_claims_org_idx
  ON public.lease_analysis_claims (organization_id, created_at);

ALTER TABLE public.lease_analysis_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_analysis_claims FROM anon, authenticated;

-- Returns a claim id, or NULL when a free organization is at its limit.
-- Paid (active/trialing) organizations are never limited but still get a
-- claim so the caller has one code path. A claim older than 2 minutes is
-- treated as abandoned (the route's maxDuration is 60s).
CREATE OR REPLACE FUNCTION public.claim_lease_analysis(
  p_org_id uuid,
  p_free_limit integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_used integer;
  v_claim uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_write_org(p_org_id) THEN
    RAISE EXCEPTION 'No write access to this organization';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lease_claim:' || p_org_id::text, 0));

  DELETE FROM public.lease_analysis_claims
  WHERE organization_id = p_org_id
    AND created_at < now() - interval '2 minutes';

  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE organization_id = p_org_id
      AND status IN ('active', 'trialing')
  ) THEN
    SELECT
      (SELECT count(*) FROM public.lease_abstracts WHERE organization_id = p_org_id)
      + (SELECT count(*) FROM public.lease_analysis_claims WHERE organization_id = p_org_id)
    INTO v_used;

    IF v_used >= p_free_limit THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.lease_analysis_claims (organization_id, user_id)
  VALUES (p_org_id, v_user)
  RETURNING id INTO v_claim;

  RETURN v_claim;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_lease_analysis_claim(p_claim_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.lease_analysis_claims
  WHERE id = p_claim_id
    AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.claim_lease_analysis(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_lease_analysis_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_lease_analysis(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_lease_analysis_claim(uuid) TO authenticated;
