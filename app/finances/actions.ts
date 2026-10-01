"use server"

import { revalidatePath } from "next/cache"

import { writeAuditLog } from "@/lib/audit/write"
import { prorateOperatingExpense, toMoney } from "@/lib/enterprise/metrics"
import { requireWritableOrg } from "@/lib/org/context"
import { createClient } from "@/lib/supabase/server"
import { toNumber } from "@/lib/telemetry/metrics"
import type { LeasePresentation } from "@/lib/enterprise/types"
import type { LeaseRow } from "@/lib/telemetry/types"

export type OpexActionState =
  | { ok: true; allocated: number }
  | { ok: false; error: string }
  | null

export type AccountingActionState =
  | { ok: true }
  | { ok: false; error: string }
  | null

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

  try {
    const org = await requireWritableOrg()
    const supabase = await createClient()

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, user_id, organization_id, name, total_nra")
      .eq("id", propertyId)
      .eq("organization_id", org.orgId)
      .maybeSingle()

    if (propertyError || !property) {
      return { ok: false, error: "That property is not in this workspace." }
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
          supabase,
          userId: org.userId,
          organizationId: org.orgId,
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
      supabase,
      userId: org.userId,
      organizationId: org.orgId,
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
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save expense.",
    }
  }
}

export const updateLeaseAccountingInputs = async (
  _prev: AccountingActionState,
  formData: FormData
): Promise<AccountingActionState> => {
  const leaseId = String(formData.get("lease_id") ?? "").trim()
  const ratePct = Number.parseFloat(String(formData.get("ibr_pct") ?? ""))
  const idc = toMoney(formData.get("initial_direct_costs")) ?? 0
  const prepaid = toMoney(formData.get("prepaid_rent")) ?? 0
  const incentives = toMoney(formData.get("lease_incentives")) ?? 0
  const presentationRaw = String(formData.get("presentation") ?? "finance")
  const presentation: LeasePresentation =
    presentationRaw === "operating" ? "operating" : "finance"

  if (!leaseId || !Number.isFinite(ratePct) || ratePct < 0) {
    return { ok: false, error: "Enter a valid incremental borrowing rate." }
  }

  try {
    const org = await requireWritableOrg()
    const supabase = await createClient()

    const { data: lease, error: leaseError } = await supabase
      .from("leases")
      .select("id, property_id")
      .eq("id", leaseId)
      .maybeSingle()

    if (leaseError || !lease) {
      return { ok: false, error: "Lease not found." }
    }

    const { data: property } = await supabase
      .from("properties")
      .select("id, organization_id")
      .eq("id", lease.property_id)
      .eq("organization_id", org.orgId)
      .maybeSingle()

    if (!property) {
      return { ok: false, error: "That lease is not in this workspace." }
    }

    const { error: updateError } = await supabase
      .from("leases")
      .update({
        incremental_borrowing_rate: ratePct / 100,
        initial_direct_costs: idc,
        prepaid_rent: prepaid,
        lease_incentives: incentives,
        accounting_presentation: presentation,
      })
      .eq("id", leaseId)

    if (updateError) {
      return { ok: false, error: updateError.message }
    }

    await writeAuditLog({
      supabase,
      userId: org.userId,
      organizationId: org.orgId,
      action: "update",
      resourceType: "lease_accounting",
      details: {
        lease_id: leaseId,
        incremental_borrowing_rate: ratePct / 100,
        initial_direct_costs: idc,
        prepaid_rent: prepaid,
        lease_incentives: incentives,
        presentation,
      },
    })

    revalidatePath("/finances/compliance")
    revalidatePath("/enterprise")
    revalidatePath("/security")
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save inputs.",
    }
  }
}
