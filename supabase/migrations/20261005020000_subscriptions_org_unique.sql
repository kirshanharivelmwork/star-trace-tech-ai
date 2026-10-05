-- One billing row per organization, and one per Stripe subscription.
--
-- The Stripe webhook upserts with `onConflict: organization_id`
-- (app/api/stripe/webhook/route.ts). PostgREST turns that into
-- `ON CONFLICT (organization_id)`, which requires a matching UNIQUE index.
-- Billing reads (lib/stripe/server.ts, checkout, portal) already assume at
-- most one row per organization via `.maybeSingle()`.
--
-- NULLs stay distinct (default), so legacy rows with a NULL organization_id
-- or NULL stripe_subscription_id are unaffected.
--
-- Safe to re-run. Fails loudly (instead of deleting billing data) if
-- duplicates already exist; resolve those by hand, then re-run.
--
-- NOTE: the base definition of public.subscriptions is not in this repo.
-- If `user_id` is the table's PRIMARY KEY or has its own UNIQUE constraint,
-- a user who owns more than one organization cannot have a subscription row
-- for each. Check in Supabase (Table Editor > subscriptions > Definition)
-- and, if so, drop that constraint and keep the organization_id one.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE organization_id IS NOT NULL
    GROUP BY organization_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate subscriptions rows per organization_id exist; resolve manually before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate subscriptions rows per stripe_subscription_id exist; resolve manually before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_organization_id_unique_idx
  ON public.subscriptions (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_unique_idx
  ON public.subscriptions (stripe_subscription_id);

-- Superseded by the unique index above (same column).
DROP INDEX IF EXISTS public.subscriptions_organization_id_idx;
