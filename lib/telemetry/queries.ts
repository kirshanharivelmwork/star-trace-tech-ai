import { createClient } from "@/lib/supabase/server"
import {
  calculateWaltYears,
  classifyRenewalRisk,
  daysUntil,
  isActiveLease,
  quarterlyExpirationFunnel,
  readNumericField,
  toDate,
  toNumber,
} from "@/lib/telemetry/metrics"
import type {
  IntelligenceSnapshot,
  LeaseRow,
  PortfolioMetricsSummaryRow,
  PropertyRow,
  RenewalRisk,
  TenantRiskRow,
  TenantRiskTelemetryRow,
} from "@/lib/telemetry/types"

const SUMMARY_VALUE_KEYS = [
  "total_portfolio_valuation",
  "portfolio_valuation",
  "valuation",
]
const SUMMARY_NRA_KEYS = [
  "total_nra",
  "net_rentable_area",
  "nra",
  "total_net_rentable_area",
  "portfolio_nra",
]
const SUMMARY_WALT_KEYS = [
  "walt_years",
  "walt",
  "weighted_average_lease_term",
  "wale_years",
  "remaining_walt",
]
const SUMMARY_ACTIVE_KEYS = [
  "active_lease_count",
  "active_leases",
  "lease_count",
  "total_leases",
]

/**
 * Server-only fetch of the corporate intelligence tables for the active
 * organization. Properties are the tenancy boundary (`organization_id`);
 * leases and telemetry hang off those rows via `property_id` / `lease_id`.
 */
export const fetchPortfolioIntelligence = async (
  organizationId: string,
  ownerUserId?: string
): Promise<IntelligenceSnapshot> => {
  const supabase = await createClient()
  const now = new Date()

  let summary: PortfolioMetricsSummaryRow | null = null
  if (ownerUserId) {
    const { data: summaryData, error: summaryError } = await supabase
      .from("portfolio_metrics_summary")
      .select("*")
      .eq("user_id", ownerUserId)
      .maybeSingle()

    if (summaryError) {
      console.error(
        "[telemetry] portfolio_metrics_summary:",
        summaryError.message
      )
    }
    summary = (summaryData ?? null) as PortfolioMetricsSummaryRow | null
  }

  const { data: propertyData, error: propertyError } = await supabase
    .from("properties")
    .select(
      "id, user_id, organization_id, name, address, valuation, total_nra, created_at"
    )
    .eq("organization_id", organizationId)

  if (propertyError) {
    console.error("[telemetry] properties:", propertyError.message)
  }

  const properties = (propertyData ?? []) as PropertyRow[]
  const propertyIds = properties.map((property) => property.id)
  const propertyById = new Map(properties.map((property) => [property.id, property]))

  let leases: LeaseRow[] = []
  if (propertyIds.length > 0) {
    const { data: leaseData, error: leaseError } = await supabase
      .from("leases")
      .select(
        "id, property_id, tenant_name, status, start_date, end_date, square_footage, monthly_rent, created_at, needs_review"
      )
      .in("property_id", propertyIds)

    if (leaseError) {
      console.error("[telemetry] leases:", leaseError.message)
    } else {
      leases = (leaseData ?? []) as LeaseRow[]
    }
  }

  const leaseIds = leases.map((lease) => lease.id)
  let telemetry: TenantRiskTelemetryRow[] = []
  if (leaseIds.length > 0) {
    const { data: telemetryData, error: telemetryError } = await supabase
      .from("tenant_risk_telemetry")
      .select("id, lease_id, risk_level, churn_score, updated_at")
      .in("lease_id", leaseIds)

    if (telemetryError) {
      console.error("[telemetry] tenant_risk_telemetry:", telemetryError.message)
    } else {
      telemetry = (telemetryData ?? []) as TenantRiskTelemetryRow[]
    }
  }

  const activeLeases = leases.filter((lease) => isActiveLease(lease, now))
  const computedNraFromProperties = properties.reduce((sum, property) => {
    return sum + (toNumber(property.total_nra) ?? 0)
  }, 0)
  const computedNraFromLeases = leases.reduce((sum, lease) => {
    return sum + (toNumber(lease.square_footage) ?? 0)
  }, 0)
  const computedValuation = properties.reduce((sum, property) => {
    return sum + (toNumber(property.valuation) ?? 0)
  }, 0)

  const valuation =
    readNumericField(summary ?? undefined, SUMMARY_VALUE_KEYS) ??
    (computedValuation > 0 ? computedValuation : null)
  const nra =
    readNumericField(summary ?? undefined, SUMMARY_NRA_KEYS) ??
    (computedNraFromProperties > 0
      ? computedNraFromProperties
      : computedNraFromLeases > 0
        ? computedNraFromLeases
        : null)
  const waltYears =
    readNumericField(summary ?? undefined, SUMMARY_WALT_KEYS) ??
    calculateWaltYears(activeLeases, now)
  const summaryActive = readNumericField(summary ?? undefined, SUMMARY_ACTIVE_KEYS)
  const activeLeaseCount = summaryActive != null ? summaryActive : activeLeases.length

  const quarterlyFunnel = quarterlyExpirationFunnel(activeLeases, now)

  const telemetryByLease = new Map(
    telemetry
      .filter((row) => row.lease_id)
      .map((row) => [row.lease_id as string, row])
  )

  const tenantRisk: TenantRiskRow[] = leases.map((lease) => {
    const row = telemetryByLease.get(lease.id)
    const property = lease.property_id
      ? propertyById.get(lease.property_id)
      : undefined
    const churnScore = toNumber(row?.churn_score ?? null)
    const expirationDate = toDate(lease.end_date ?? null)
    const risk = row
      ? classifyRenewalRisk(row.risk_level, churnScore)
      : classifyRenewalRisk(null, expirationDate ? riskFromExpiry(expirationDate, now) : null)

    return {
      telemetryId: row?.id ?? `lease:${lease.id}`,
      leaseId: lease.id,
      tenantName: lease.tenant_name?.trim() || "Unnamed tenant",
      propertyName: property?.name ?? null,
      risk,
      riskLevelRaw: row?.risk_level ?? null,
      churnScore,
      expirationDate,
      daysUntilExpiry: expirationDate ? daysUntil(expirationDate, now) : null,
      monthlyRent: toNumber(lease.monthly_rent ?? null),
      squareFootage: toNumber(lease.square_footage ?? null),
      updatedAt: row?.updated_at ?? lease.created_at,
    }
  })

  tenantRisk.sort((a, b) => {
    const rank: Record<RenewalRisk, number> = { high: 0, upcoming: 1, safe: 2 }
    const byRisk = rank[a.risk] - rank[b.risk]
    if (byRisk !== 0) return byRisk
    return (a.daysUntilExpiry ?? 99999) - (b.daysUntilExpiry ?? 99999)
  })

  const riskCounts: Record<RenewalRisk, number> = {
    safe: 0,
    upcoming: 0,
    high: 0,
  }
  for (const row of tenantRisk) {
    riskCounts[row.risk] += 1
  }

  return {
    valuation,
    nra,
    waltYears,
    activeLeaseCount,
    propertyCount: properties.length,
    quarterlyFunnel,
    tenantRisk,
    expirationSeries: quarterlyFunnel.map((bucket) => bucket.count),
    expirationLabels: quarterlyFunnel.map((bucket) => bucket.label),
    riskCounts,
  }
}

const riskFromExpiry = (end: Date, now: Date): number => {
  const days = daysUntil(end, now)
  if (days <= 90) return 0.85
  if (days <= 365) return 0.5
  return 0.15
}
