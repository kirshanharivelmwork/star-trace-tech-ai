import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const DB_TIMEOUT_MS = 3000

const respond = (ok: boolean, database: "ok" | "fail") =>
  Response.json(
    { status: ok ? "ok" : "degraded", checks: { database } },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )

/**
 * Liveness/readiness probe for uptime monitors. Public by design, so it
 * reports only pass/fail: no versions, env names, hostnames, or error text.
 *
 * It uses the anon key (not the service role): the query is allowed to return
 * zero rows under RLS. What it proves is that the database and PostgREST are
 * reachable and that the schema has been migrated (a missing table errors).
 */
export const GET = async () => {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("organizations")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))

    if (error) {
      console.error("[health] database check failed:", error.message)
      return respond(false, "fail")
    }
    return respond(true, "ok")
  } catch (error) {
    console.error(
      "[health] database check threw:",
      error instanceof Error ? error.message : "unknown error"
    )
    return respond(false, "fail")
  }
}
