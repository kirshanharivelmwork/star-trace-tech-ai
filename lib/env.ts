/**
 * Production environment validation.
 *
 * `assertProductionEnv` is called from `instrumentation.ts` when the server
 * starts. A missing secret otherwise only surfaces when the first user hits the
 * affected route (a 500 from the webhook, a silent no-op cron, ...), so we fail
 * at boot instead.
 *
 * Every variable listed here is read by a code path that refuses to work
 * without it. Variables that are only *recommended* are warned about, not
 * required.
 */

type Env = Record<string, string | undefined>

type EnvRequirement = {
  /** Any ONE of these names satisfies the requirement. */
  names: readonly string[]
  why: string
}

export const REQUIRED_PRODUCTION_ENV: readonly EnvRequirement[] = [
  { names: ["NEXT_PUBLIC_SUPABASE_URL"], why: "Supabase project URL" },
  { names: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"], why: "Supabase anon key (auth + RLS-scoped queries)" },
  { names: ["SUPABASE_SERVICE_ROLE_KEY"], why: "Stripe webhook, cron and billing lookups (server only)" },
  { names: ["NEXT_PUBLIC_APP_URL"], why: "canonical origin for auth/Stripe redirects and email links" },
  { names: ["STRIPE_SECRET_KEY"], why: "Stripe API" },
  { names: ["STRIPE_WEBHOOK_SECRET"], why: "Stripe webhook signature verification" },
  { names: ["NEXT_PUBLIC_STRIPE_PRO_PRICE_ID"], why: "Pro plan checkout" },
  { names: ["RESEND_API_KEY"], why: "alert and invite email" },
  { names: ["RESEND_FROM", "RESEND_FROM_EMAIL"], why: "verified From address for email" },
  { names: ["ANTHROPIC_API_KEY"], why: "lease analysis and chat" },
  { names: ["CRON_SECRET"], why: "authenticates the Vercel Cron call to /api/cron/alerts" },
]

const URL_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"] as const

const isSet = (env: Env, name: string): boolean => Boolean(env[name]?.trim())

/** Returns human-readable problems; an empty array means the env is valid. */
export const getEnvProblems = (env: Env): string[] => {
  const problems: string[] = []

  for (const { names, why } of REQUIRED_PRODUCTION_ENV) {
    if (names.some((name) => isSet(env, name))) continue
    problems.push(`${names.join(" or ")} is not set (${why})`)
  }

  for (const name of URL_VARS) {
    const value = env[name]?.trim()
    if (!value) continue
    try {
      new URL(value)
    } catch {
      problems.push(`${name} is not a valid absolute URL`)
    }
  }

  return problems
}

/**
 * Throws on a production server with an incomplete environment.
 * Vercel preview deployments only log: previews routinely run with a subset of
 * variables and should not be bricked by that.
 */
export const assertProductionEnv = (env: Env = process.env): void => {
  if (env.NODE_ENV !== "production") return

  const problems = getEnvProblems(env)
  if (problems.length === 0) return

  const message = `Invalid production environment:\n - ${problems.join("\n - ")}`

  if (env.VERCEL_ENV === "preview") {
    console.error(`[env] ${message}`)
    return
  }

  throw new Error(message)
}
