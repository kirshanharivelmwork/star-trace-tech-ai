import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cachedAdminClient: SupabaseClient | null = null

/**
 * Service-role Supabase client for system-level server code that has no
 * authenticated end-user request context and must bypass RLS by design —
 * Stripe webhooks (app/api/stripe/webhook/route.ts), billing lookups
 * (lib/stripe/server.ts), and the daily cron job
 * (app/api/cron/alerts/route.ts).
 *
 * Cached across invocations within the same server process: this client
 * carries no per-request/cookie state (unlike lib/supabase/server.ts), so
 * reusing one instance is safe and avoids re-parsing config on every call.
 *
 * NEVER import this from client code or expose SUPABASE_SERVICE_ROLE_KEY
 * to the browser.
 */
export const createAdminClient = (): SupabaseClient => {
  if (cachedAdminClient) return cachedAdminClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the service-role Supabase client cannot be created."
    )
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return cachedAdminClient
}
