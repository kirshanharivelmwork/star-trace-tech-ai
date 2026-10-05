# StarFlow

AI lease abstraction and portfolio tooling for commercial real estate teams.
Upload a lease PDF, get a structured abstract, then track notice windows, CAM,
lessee accounting and expiry alerts from the same record.

**Stack:** Next.js 16 (App Router) · Supabase (`@supabase/ssr`) · Stripe ·
Resend · Vercel AI SDK (Anthropic) · Tailwind CSS + shadcn/ui · Vercel Cron.

Project conventions live in `.cursor/rules/stack.mdc` and `AGENTS.md`. This
Next.js version differs from older releases (for example error boundaries
receive `retry`, and the auth refresh file is `proxy.ts`); read
`node_modules/next/dist/docs/` before changing framework code.

## Local setup

Requirements: Node.js 20.9+ (CI uses 24) and npm.

```bash
npm ci
cp .env.example .env.local   # then fill it in, see "Environment variables"
npm run dev                  # http://localhost:3000
```

| Script              | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Dev server                            |
| `npm run typecheck` | `tsc --noEmit`                        |
| `npm run lint`      | ESLint                                |
| `npm test`          | Vitest (all external services mocked) |
| `npm run build`     | Production build                      |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test and build on every
pull request, using placeholder environment variables only.

## Environment variables

`.env.example` is the authoritative list. All variables there are **required in
production**: the server refuses to start if any is missing or malformed
(`lib/env.ts`, run from `instrumentation.ts`). Vercel preview deployments log
the problem instead of failing.

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`)
must never be given a `NEXT_PUBLIC_` prefix.

## Database (Supabase)

Migrations are in `supabase/migrations/`. **They are written to be pasted into
the Supabase SQL editor, in filename order, against the existing project**; they
are not run by a CLI in this repo.

1. `20261001_starflow_institutional.sql`: organizations, members, invites, RLS helpers
2. `20261005010000_alert_dispatches_idempotent.sql`: unique key so cron alerts dedupe
3. `20261005020000_subscriptions_org_unique.sql`: one subscription row per org
4. `20261005030000_rls_hardening.sql`: tenancy policies
5. `20261005040000_rate_limits_and_claims.sql`: rate limiter + atomic free-plan claim
6. `20261005050000_leases_storage_bucket.sql`: private `leases` bucket + org-scoped policies

> **Not reproducible from this repo alone.** The original base tables and views
> (`lease_abstracts`, `properties`, `leases`, `notice_windows`,
> `operating_expenses`, `tenant_cam_allocations`, `subscriptions`,
> `audit_logs`, `portfolio_metrics_summary`, `tenant_risk_telemetry`) predate
> version control. A brand-new Supabase project needs those created first.

After applying migrations, run `supabase/checks/rls_audit.sql` in the SQL
editor. Every query in it must return zero rows.

### Auth

In Supabase **Authentication > URL configuration**, set the Site URL to
`NEXT_PUBLIC_APP_URL` and add `<NEXT_PUBLIC_APP_URL>/auth/callback` to the
redirect allow-list. Email/password and the Google/Microsoft OAuth providers
used on `/login` must be enabled there.

## Stripe

1. Create a recurring Pro price and set its id as `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID`.
2. Add a webhook endpoint: `https://<your-domain>/api/stripe/webhook`
   subscribed to `checkout.session.completed`,
   `customer.subscription.updated` and `customer.subscription.deleted`.
3. Copy the endpoint's signing secret (`whsec_...`) to `STRIPE_WEBHOOK_SECRET`.
4. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   and use the `whsec_` it prints.

The webhook answers `500` on any failed database write, so Stripe retries;
handlers are idempotent.

## Email and cron

`vercel.json` schedules `GET /api/cron/alerts` daily at 08:00 UTC. Vercel sends
`Authorization: Bearer $CRON_SECRET`; the route rejects anything else, and
refuses to run if `CRON_SECRET` or `RESEND_API_KEY` is unset. A lease alert is
only marked as sent after at least one email was accepted by Resend, and a
missed run is retried for a few days. Vercel does not retry failed cron calls.

The sending domain in `RESEND_FROM` / `RESEND_FROM_EMAIL` must be verified in
Resend.

## Operations

- **Health:** `GET /api/health` returns `200 {"status":"ok"}` when the database
  is reachable and migrated, otherwise `503`. It exposes no details; point an
  uptime monitor at it.
- **AI model:** a single constant in `lib/ai/model.ts`. All LLM calls are Route
  Handlers (`app/api/lease`, `app/api/chat`) with auth, role checks, size caps
  and per-user/per-org rate limits.
- **Function limits:** `/api/lease` 60 s, `/api/chat` 30 s, cron 60 s.
  Vercel's request body limit is 4.5 MB, which is why lease PDFs are capped at
  about 3.3 MB (`lib/lease/limits.ts`).
- **Security headers / CSP:** `next.config.ts`.

## Known gaps

- Clerk (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) is not used by
  any code. Auth is Supabase. Remove those from `.env.local` and your hosting
  provider when convenient.
- `@ai-sdk/openai` is installed but unused; `OPENAI_API_KEY` is read by nothing.
- No error-reporting service is wired up; errors go to server logs.
