"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { prorateOperatingExpense, toMoney } from "@/lib/enterprise/metrics"
import { createClient } from "@/lib/supabase/server"
import { toNumber } from "@/lib/telemetry/metrics"
import type { LeaseRow } from "@/lib/telemetry/types"

export type OpexActionState =
  | { ok: true; allocated: number }
  | { ok: false; error: string }
  | null

const clientIp = async (): Promise<string | null> => {
  const headerStore = await headers()
  const forwarded = headerStore.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || null
  return headerStore.get("x-real-ip")
}

const writeAuditLog = async (params: {
  userId: string
  action: string
  resourceType: string
  details: Record<string, unknown>
}) => {
  const supabase = await createClient()
  const ip = await clientIp()
  const { error } = await supabase.from("audit_logs").insert({
    user_id: params.userId,
    action: params.action,
    resource_type: params.resourceType,
    details: params.details,
    ip_address: ip,
  })

  if (error) {
    console.error("[enterprise] audit_logs insert:", error.message)
  }
}

export const logOperatingExpense = async (
  _prev: OpexActionState,
  formData: FormData
): Promise<OpexActionState> => {
  const propertyId = String(formData.get("property_id") ?? "").trim()
  const category = String(formData.get("expense_category") ?? "").trim()
  const incurredDate = String(formData.get("incurred_date") ?? "").trim()
  const amount = toMoney(formData.get("amount"))

  if (!propertyId || !category || !incurredDate || amount == null || amount <= 0) {
    return { ok: false, error: "Enter a property, category, date, and amount." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: "Sign in to log operating expenses." }
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, user_id, name, total_nra")
    .eq("id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (propertyError || !property) {
    return { ok: false, error: "That property is not in your portfolio." }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("operating_expenses")
    .insert({
      property_id: propertyId,
      amount,
      expense_category: category,
      incurred_date: incurredDate,
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    console.error("[enterprise] operating_expenses insert:", insertError?.message)
    return {
      ok: false,
      error: insertError?.message ?? "Could not save the operating expense.",
    }
  }

  const { data: leaseData, error: leaseError } = await supabase
    .from("leases")
    .select(
      "id, property_id, tenant_name, status, start_date, end_date, square_footage, monthly_rent, created_at"
    )
    .eq("property_id", propertyId)

  if (leaseError) {
    console.error("[enterprise] leases for CAM:", leaseError.message)
  }

  const leases = (leaseData ?? []) as LeaseRow[]
  const shares = prorateOperatingExpense({
    amount,
    propertyNra: toNumber(property.total_nra),
    leases: leases.map((lease) => ({
      id: lease.id,
      squareFootage: toNumber(lease.square_footage),
    })),
  })

  if (shares.length > 0) {
    const { error: allocationError } = await supabase
      .from("tenant_cam_allocations")
      .insert(
        shares.map((share) => ({
          lease_id: share.leaseId,
          expense_id: inserted.id,
          allocated_amount: share.allocatedAmount,
          status: "allocated",
        }))
      )

    if (allocationError) {
      console.error(
        "[enterprise] tenant_cam_allocations insert:",
        allocationError.message
      )
      await writeAuditLog({
        userId: user.id,
        action: "create",
        resourceType: "operating_expenses",
        details: {
          expense_id: inserted.id,
          property_id: propertyId,
          amount,
          allocations: 0,
          allocation_error: allocationError.message,
        },
      })
      revalidatePath("/finances/cam")
      return {
        ok: false,
        error: `Expense saved, but allocations failed: ${allocationError.message}`,
      }
    }
  }

  await writeAuditLog({
    userId: user.id,
    action: "create",
    resourceType: "operating_expenses",
    details: {
      expense_id: inserted.id,
      property_id: propertyId,
      amount,
      category,
      allocations: shares.length,
    },
  })

  revalidatePath("/finances/cam")
  revalidatePath("/security")
  return { ok: true, allocated: shares.length }
}
