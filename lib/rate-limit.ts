import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Per-user AND per-organization caps for the LLM routes, enforced in
 * Postgres (public.consume_rate_limit — see
 * supabase/migrations/20261005040000_rate_limits_and_claims.sql) so the
 * limit holds across serverless instances. No external service.
 */
export const RATE_LIMITS = {
  chat: { windowSeconds: 60, perUser: 20, perOrg: 60 },
  lease: { windowSeconds: 3600, perUser: 15, perOrg: 40 },
} as const

export type RateLimitScope = keyof typeof RATE_LIMITS

export type RateLimitResult = "ok" | "limited" | "error"

export const checkRateLimit = async (
  supabase: SupabaseClient,
  scope: RateLimitScope,
  orgId: string
): Promise<RateLimitResult> => {
  const limit = RATE_LIMITS[scope]

  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_scope: scope,
    p_org_id: orgId,
    p_window_seconds: limit.windowSeconds,
    p_user_limit: limit.perUser,
    p_org_limit: limit.perOrg,
  })

  if (error) {
    console.error(`[rate-limit] ${scope}:`, error.message)
    return "error"
  }

  return data === true ? "ok" : "limited"
}

/** Maps a non-ok result to the HTTP response to return. Fails closed. */
export const rateLimitResponse = (
  result: Exclude<RateLimitResult, "ok">,
  scope: RateLimitScope
): Response => {
  if (result === "limited") {
    return new Response("Too many requests. Please slow down and try again shortly.", {
      status: 429,
      headers: { "Retry-After": String(RATE_LIMITS[scope].windowSeconds) },
    })
  }

  return new Response("Service temporarily unavailable. Please try again.", {
    status: 503,
  })
}
