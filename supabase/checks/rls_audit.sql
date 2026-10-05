-- Read-only audit of the LIVE database. Paste into the Supabase SQL editor
-- after applying migrations. Every query should return ZERO rows.

-- 1. Public tables without row level security.
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- 2. Policies that allow everything (USING (true) / WITH CHECK (true)).
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (qual = 'true' OR with_check = 'true');

-- 3. Public tables with RLS enabled but NO policy (deny-all: fine for
--    rate_limit_counters / lease_analysis_claims, suspicious for anything else).
SELECT c.relname AS table_with_no_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
GROUP BY c.relname
HAVING count(p.policyname) = 0;

-- 4. Public Storage buckets (the `leases` bucket must NOT be listed).
SELECT id, name, public FROM storage.buckets WHERE public;

-- 5. Anyone-can-write policies on `subscriptions` (must be none: only the
--    Stripe webhook / service role may write billing state).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'subscriptions' AND cmd <> 'SELECT';

-- 6. anon role privileges on app tables (login-only app: expect none).
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon';
