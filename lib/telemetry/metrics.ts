import type { LeaseRow, RenewalRisk } from "@/lib/telemetry/types"

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25
const MS_PER_DAY = 1000 * 60 * 60 * 24

const ACTIVE_STATUS = new Set([
  "active",
  "in_place",
  "in-place",
  "current",
  "occupied",
  "commenced",
])

const INACTIVE_STATUS = new Set([
  "expired",
  "terminated",
  "inactive",
  "cancelled",
  "canceled",
  "vacated",
])

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const remainingTermYears = (endDate: Date, now: Date): number | null => {
  const delta = endDate.getTime() - now.getTime()
  if (delta < 0) return null
  return delta / MS_PER_YEAR
}

export const daysUntil = (endDate: Date, now: Date): number =>
  Math.round((endDate.getTime() - now.getTime()) / MS_PER_DAY)

export const isActiveLease = (lease: LeaseRow, now: Date): boolean => {
  const status = lease.status?.trim().toLowerCase() ?? ""
  if (status && INACTIVE_STATUS.has(status)) return false
  if (status && ACTIVE_STATUS.has(status)) {
    const end = toDate(lease.end_date)
    return !end || end.getTime() >= now.getTime()
  }

  const end = toDate(lease.end_date)
  if (!end) return !status
  return end.getTime() >= now.getTime()
}

/**
 * Remaining-term WALT in years, weighted by square footage, then monthly
 * rent, then equal-weighted. Leases without a parseable future end date
 * are skipped so they cannot drag the average to NaN.
 */
export const calculateWaltYears = (
  leases: LeaseRow[],
  now: Date = new Date()
): number | null => {
  let weighted = 0
  let weights = 0

  for (const lease of leases) {
    if (!isActiveLease(lease, now)) continue
    const end = toDate(lease.end_date)
    if (!end) continue
    const years = remainingTermYears(end, now)
    if (years == null) continue

    const weight =
      toNumber(lease.square_footage) ?? toNumber(lease.monthly_rent) ?? 1
    if (weight <= 0) continue

    weighted += years * weight
    weights += weight
  }

  if (weights === 0) return null
  return weighted / weights
}

export const startOfQuarter = (date: Date): Date => {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3
  return new Date(date.getFullYear(), quarterMonth, 1)
}

export const addQuarters = (date: Date, count: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + count * 3, 1)

const quarterLabel = (start: Date) => {
  const q = Math.floor(start.getMonth() / 3) + 1
  return `Q${q} ${start.getFullYear()}`
}

/** Next four calendar quarters, counting active leases whose end_date falls in each. */
export const quarterlyExpirationFunnel = (
  leases: LeaseRow[],
  now: Date = new Date()
) => {
  const origin = startOfQuarter(now)
  const buckets = [0, 1, 2, 3].map((offset) => {
    const start = addQuarters(origin, offset)
    const end = addQuarters(origin, offset + 1)
    return {
      key: `${start.getFullYear()}-q${Math.floor(start.getMonth() / 3) + 1}`,
      label: quarterLabel(start),
      start,
      end,
      count: 0,
    }
  })

  for (const lease of leases) {
    if (!isActiveLease(lease, now)) continue
    const end = toDate(lease.end_date)
    if (!end) continue

    const bucket = buckets.find(
      (candidate) =>
        end.getTime() >= candidate.start.getTime() &&
        end.getTime() < candidate.end.getTime()
    )
    if (bucket) bucket.count += 1
  }

  return buckets
}

const GREEN = new Set([
  "green",
  "safe",
  "low",
  "healthy",
  "good",
  "pass",
])
const AMBER = new Set([
  "amber",
  "yellow",
  "medium",
  "watch",
  "upcoming",
  "moderate",
  "negotiate",
  "negotiation",
])
const RED = new Set([
  "red",
  "high",
  "critical",
  "vacancy",
  "severe",
  "fail",
  "churn",
])

const scoreToRisk = (score: number): RenewalRisk => {
  const normalized = score > 1 ? score / 100 : score
  if (normalized >= 0.66) return "high"
  if (normalized >= 0.33) return "upcoming"
  return "safe"
}

export const classifyRenewalRisk = (
  riskLevel: string | null | undefined,
  churnScore: number | null
): RenewalRisk => {
  const label = riskLevel?.trim().toLowerCase() ?? ""
  if (GREEN.has(label)) return "safe"
  if (AMBER.has(label)) return "upcoming"
  if (RED.has(label)) return "high"
  if (churnScore != null) return scoreToRisk(churnScore)
  return "upcoming"
}

export const readNumericField = (
  row: Record<string, unknown> | null | undefined,
  keys: string[]
): number | null => {
  if (!row) return null
  for (const key of keys) {
    const value = toNumber(row[key])
    if (value != null) return value
  }
  return null
}
