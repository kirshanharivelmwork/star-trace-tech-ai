import type { SupabaseClient } from "@supabase/supabase-js"

import { writeAuditLog } from "@/lib/audit/write"
import {
  normalizeMatchKey,
  parseAnnualRate,
  parseLeaseDate,
  parseMonthlyRent,
  parseNoticeDeadlines,
  parseSquareFootage,
  toIsoDateString,
  type PortfolioLeaseAbstract,
} from "@/lib/lease/portfolio-metrics"

type PropertyMatchRow = {
  id: string
  name: string | null
  address: string | null
  total_nra: number | string | null
}

type LeaseMatchRow = {
  id: string
  property_id: string | null
  tenant_name: string | null
}

export type HydrateAbstractResult = {
  propertyId: string | null
  leaseId: string | null
  needsReview: boolean
}

const isMissing = (value: string | number | null | undefined): boolean =>
  value == null || (typeof value === "string" && !value.trim())

/**
 * After a successful abstract persist, upsert the canonical property +
 * lease rows the rest of the product reads. Best-effort: parse failures
 * set needs_review and never throw.
 */
export const hydrateCanonicalLease = async (params: {
  supabase: SupabaseClient
  userId: string
  organizationId: string
  abstractId: string
  fileName: string
  abstract: PortfolioLeaseAbstract
}): Promise<HydrateAbstractResult> => {
  const { supabase, userId, organizationId, abstractId, fileName, abstract } =
    params

  const result: HydrateAbstractResult = {
    propertyId: null,
    leaseId: null,
    needsReview: false,
  }

  try {
    const propertyName =
      (abstract.propertyName && abstract.propertyName.trim()) ||
      (abstract.premisesAddress && abstract.premisesAddress.trim()) ||
      fileName.replace(/\.pdf$/i, "")

    const address = abstract.premisesAddress?.trim() || null
    const squareFootage = parseSquareFootage(abstract.premisesSquareFootage)
    const monthlyRent =
      parseMonthlyRent(abstract.monthlyBaseRentAmount) ??
      parseMonthlyRent(abstract.initialBaseRent, abstract.rentPaymentFrequency)
    const startDate = toIsoDateString(parseLeaseDate(abstract.commencementDate))
    const endDate = toIsoDateString(parseLeaseDate(abstract.expirationDate))
    const tenantName = abstract.tenantName?.trim() || "Unnamed tenant"
    const discountRate = parseAnnualRate(abstract.discountRateAnnual)

    result.needsReview =
      isMissing(startDate) || isMissing(endDate) || monthlyRent == null

    const propertyId = await upsertProperty({
      supabase,
      userId,
      organizationId,
      name: propertyName,
      address,
      squareFootage,
    })
    result.propertyId = propertyId

    if (!propertyId) {
      result.needsReview = true
      await markAbstract(supabase, abstractId, null, result.needsReview)
      return result
    }

    const leaseId = await upsertLease({
      supabase,
      propertyId,
      tenantName,
      startDate,
      endDate,
      squareFootage,
      monthlyRent,
      discountRate,
      needsReview: result.needsReview,
    })
    result.leaseId = leaseId

    if (leaseId) {
      await upsertNoticeWindows(supabase, leaseId, abstract)
    }

    await markAbstract(supabase, abstractId, leaseId, result.needsReview)

    await writeAuditLog({
      supabase,
      userId,
      organizationId,
      action: "create",
      resourceType: "lease_abstracts",
      details: {
        abstract_id: abstractId,
        lease_id: leaseId,
        property_id: propertyId,
        file_name: fileName,
        needs_review: result.needsReview,
      },
    })
  } catch (error) {
    console.error("[hydrate] failed to unify abstract into lease record:", error)
    result.needsReview = true
    try {
      await markAbstract(supabase, abstractId, result.leaseId, true)
    } catch (markError) {
      console.error("[hydrate] failed to flag needs_review:", markError)
    }
  }

  return result
}

const markAbstract = async (
  supabase: SupabaseClient,
  abstractId: string,
  leaseId: string | null,
  needsReview: boolean
) => {
  const { error } = await supabase
    .from("lease_abstracts")
    .update({
      lease_id: leaseId,
      needs_review: needsReview,
    })
    .eq("id", abstractId)

  if (error) {
    console.error("[hydrate] lease_abstracts update:", error.message)
  }
}

const upsertProperty = async (params: {
  supabase: SupabaseClient
  userId: string
  organizationId: string
  name: string
  address: string | null
  squareFootage: number | null
}): Promise<string | null> => {
  const { supabase, userId, organizationId, name, address, squareFootage } =
    params
  const nameKey = normalizeMatchKey(name)
  const addressKey = normalizeMatchKey(address)

  const { data, error } = await supabase
    .from("properties")
    .select("id, name, address, total_nra")
    .eq("organization_id", organizationId)

  if (error) {
    console.error("[hydrate] properties select:", error.message)
  }

  const rows = (data ?? []) as PropertyMatchRow[]
  const match = rows.find((row) => {
    const rowName = normalizeMatchKey(row.name)
    const rowAddress = normalizeMatchKey(row.address)
    return (
      (nameKey && rowName === nameKey) ||
      (addressKey && (rowAddress === addressKey || rowName === addressKey)) ||
      (addressKey && nameKey && rowName === addressKey)
    )
  })

  if (match) {
    const nextNra =
      squareFootage != null && squareFootage > 0
        ? Math.max(Number(match.total_nra) || 0, squareFootage)
        : match.total_nra
    const { error: updateError } = await supabase
      .from("properties")
      .update({
        name: match.name?.trim() || name,
        address: match.address || address,
        total_nra: nextNra,
      })
      .eq("id", match.id)

    if (updateError) {
      console.error("[hydrate] properties update:", updateError.message)
    }
    return match.id
  }

  const { data: inserted, error: insertError } = await supabase
    .from("properties")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      name,
      address,
      total_nra: squareFootage,
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    console.error("[hydrate] properties insert:", insertError?.message)
    return null
  }

  return inserted.id as string
}

const upsertLease = async (params: {
  supabase: SupabaseClient
  propertyId: string
  tenantName: string
  startDate: string | null
  endDate: string | null
  squareFootage: number | null
  monthlyRent: number | null
  discountRate: number | null
  needsReview: boolean
}): Promise<string | null> => {
  const {
    supabase,
    propertyId,
    tenantName,
    startDate,
    endDate,
    squareFootage,
    monthlyRent,
    discountRate,
    needsReview,
  } = params

  const { data, error } = await supabase
    .from("leases")
    .select("id, property_id, tenant_name")
    .eq("property_id", propertyId)

  if (error) {
    console.error("[hydrate] leases select:", error.message)
  }

  const rows = (data ?? []) as LeaseMatchRow[]
  const tenantKey = normalizeMatchKey(tenantName)
  const match = rows.find(
    (row) => normalizeMatchKey(row.tenant_name) === tenantKey
  )

  const payload = {
    property_id: propertyId,
    tenant_name: tenantName,
    status: "active",
    start_date: startDate,
    end_date: endDate,
    square_footage: squareFootage,
    monthly_rent: monthlyRent,
    needs_review: needsReview,
    ...(discountRate != null
      ? { incremental_borrowing_rate: discountRate }
      : {}),
  }

  if (match) {
    const { error: updateError } = await supabase
      .from("leases")
      .update(payload)
      .eq("id", match.id)

    if (updateError) {
      console.error("[hydrate] leases update:", updateError.message)
    }
    return match.id
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leases")
    .insert(payload)
    .select("id")
    .single()

  if (insertError || !inserted) {
    console.error("[hydrate] leases insert:", insertError?.message)
    return null
  }

  return inserted.id as string
}

const upsertNoticeWindows = async (
  supabase: SupabaseClient,
  leaseId: string,
  abstract: PortfolioLeaseAbstract
) => {
  const deadlines = parseNoticeDeadlines(abstract)
  if (deadlines.length === 0) return

  const { data, error } = await supabase
    .from("notice_windows")
    .select("id, target_date, label")
    .eq("lease_id", leaseId)

  if (error) {
    console.error("[hydrate] notice_windows select:", error.message)
  }

  const existing = new Set(
    (data ?? []).map((row: { target_date: string | null; label: string | null }) =>
      `${row.target_date ?? ""}:${normalizeMatchKey(row.label)}`
    )
  )

  const rows = deadlines
    .filter((deadline) => {
      const key = `${deadline.targetDate}:${normalizeMatchKey(deadline.label)}`
      return !existing.has(key)
    })
    .map((deadline) => ({
      lease_id: leaseId,
      status: "open",
      target_date: deadline.targetDate,
      label: deadline.label,
      notice_days: deadline.noticeDays,
    }))

  if (rows.length === 0) return

  const { error: insertError } = await supabase.from("notice_windows").insert(rows)
  if (insertError) {
    console.error("[hydrate] notice_windows insert:", insertError.message)
  }
}

export const backfillUnlinkedAbstracts = async (params: {
  supabase: SupabaseClient
  userId: string
  organizationId: string
}): Promise<{ processed: number; linked: number }> => {
  const { supabase, userId, organizationId } = params

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("id, file_name, abstract_data, user_id")
    .eq("organization_id", organizationId)
    .is("lease_id", null)

  if (error) {
    console.error("[hydrate] backfill select:", error.message)
    return { processed: 0, linked: 0 }
  }

  const records = data ?? []
  let linked = 0

  for (const record of records) {
    const abstract = (record.abstract_data ?? {}) as PortfolioLeaseAbstract
    const result = await hydrateCanonicalLease({
      supabase,
      userId: (record.user_id as string | null) ?? userId,
      organizationId,
      abstractId: record.id as string,
      fileName: (record.file_name as string | null) ?? "lease.pdf",
      abstract,
    })
    if (result.leaseId) linked += 1
  }

  return { processed: records.length, linked }
}
