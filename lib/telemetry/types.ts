/**
 * Defensive row shapes for the live telemetry schema
 * (properties, leases, tenant_risk_telemetry, portfolio_metrics_summary).
 *
 * Confirmed via PostgREST column probes against the production project.
 * Extra keys on the summary view are read as `Record<string, unknown>` so
 * newly added view columns can be picked up without a code change — we
 * never assume a column exists at compile time.
 */

export type PropertyRow = {
  id: string
  user_id: string
  organization_id?: string | null
  name: string | null
  address?: string | null
  valuation: number | string | null
  total_nra: number | string | null
  created_at: string | null
}

export type LeaseRow = {
  id: string
  property_id: string | null
  tenant_name: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  square_footage: number | string | null
  monthly_rent: number | string | null
  created_at: string | null
  incremental_borrowing_rate?: number | string | null
  initial_direct_costs?: number | string | null
  prepaid_rent?: number | string | null
  lease_incentives?: number | string | null
  accounting_presentation?: string | null
  needs_review?: boolean | null
}

export type TenantRiskTelemetryRow = {
  id: string
  lease_id: string | null
  risk_level: string | null
  churn_score: number | string | null
  updated_at: string | null
}

export type PortfolioMetricsSummaryRow = {
  user_id: string
  total_portfolio_valuation: number | string | null
} & Record<string, unknown>

export type RenewalRisk = "safe" | "upcoming" | "high"

export type QuarterlyFunnelBucket = {
  key: string
  label: string
  start: Date
  end: Date
  count: number
}

export type TenantRiskRow = {
  telemetryId: string
  leaseId: string | null
  tenantName: string
  propertyName: string | null
  risk: RenewalRisk
  riskLevelRaw: string | null
  churnScore: number | null
  expirationDate: Date | null
  daysUntilExpiry: number | null
  monthlyRent: number | null
  squareFootage: number | null
  updatedAt: string | null
}

export type IntelligenceSnapshot = {
  valuation: number | null
  nra: number | null
  waltYears: number | null
  activeLeaseCount: number
  propertyCount: number
  quarterlyFunnel: QuarterlyFunnelBucket[]
  tenantRisk: TenantRiskRow[]
  expirationSeries: number[]
  expirationLabels: string[]
  riskCounts: Record<RenewalRisk, number>
}
