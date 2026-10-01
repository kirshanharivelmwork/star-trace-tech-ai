import { headers } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

const clientIp = async (): Promise<string | null> => {
  const headerStore = await headers()
  const forwarded = headerStore.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || null
  return headerStore.get("x-real-ip")
}

export const writeAuditLog = async (params: {
  supabase: SupabaseClient
  userId: string
  organizationId: string | null
  action: string
  resourceType: string
  details: Record<string, unknown>
}): Promise<void> => {
  const ip = await clientIp()
  const { error } = await params.supabase.from("audit_logs").insert({
    user_id: params.userId,
    organization_id: params.organizationId,
    action: params.action,
    resource_type: params.resourceType,
    details: params.details,
    ip_address: ip,
  })

  if (error) {
    console.error("[audit] insert failed:", error.message)
  }
}
