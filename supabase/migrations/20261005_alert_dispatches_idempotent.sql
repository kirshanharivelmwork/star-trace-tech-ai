-- Make alert_dispatches idempotent for ON CONFLICT DO NOTHING inserts.
--
-- Why: the original unique index (alert_dispatches_dedupe_idx) used COALESCE()
-- expressions to treat NULL lease_id / abstract_id as equal. That enforces
-- uniqueness, but PostgREST's `onConflict=col1,col2,...` cannot target an
-- expression index, so the cron could not do an atomic insert-or-ignore.
--
-- Fix: a plain-column unique index with NULLS NOT DISTINCT, so that
-- (org, type, threshold, NULL, abstract) rows collide with each other
-- instead of being treated as always-distinct (the default NULL behaviour).
--
-- REQUIRES PostgreSQL 15+ (NULLS NOT DISTINCT). All current Supabase
-- projects are 15+; check Dashboard > Settings > Infrastructure if unsure.
--
-- Safe to re-run. Existing rows cannot violate the new index because the old
-- COALESCE index already enforced the same uniqueness.

CREATE UNIQUE INDEX IF NOT EXISTS alert_dispatches_unique_idx
  ON public.alert_dispatches (
    organization_id,
    alert_type,
    threshold_days,
    lease_id,
    abstract_id
  ) NULLS NOT DISTINCT;

-- Superseded by alert_dispatches_unique_idx (same guarantee, usable by
-- ON CONFLICT inference).
DROP INDEX IF EXISTS public.alert_dispatches_dedupe_idx;
