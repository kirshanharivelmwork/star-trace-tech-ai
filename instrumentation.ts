export const register = async () => {
  // Only the Node.js server needs the check; the Edge runtime (proxy.ts) has no
  // access to the server-only secrets anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { assertProductionEnv } = await import("@/lib/env")
  assertProductionEnv()
}
