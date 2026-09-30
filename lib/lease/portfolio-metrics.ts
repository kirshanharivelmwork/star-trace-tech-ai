/**
 * Pure, dependency-free helpers for turning `lease_abstracts.abstract_data`
 * rows into portfolio-level metrics. Kept separate from
 * components/dashboard/portfolio-analytics.tsx so the parsing/calculation
 * logic is easy to reason about (and test) independently of data fetching.
 */

/**
 * Defensive shape for the `abstract_data` jsonb column as read back from
 * Supabase. Every field is optional/nullable rather than mirroring
 * `LeaseAbstract` from app/api/lease/schema.ts exactly, because:
 * - Postgres jsonb has no compile-time guarantee of shape — older or
 *   malformed rows may be missing fields entirely.
 * - Claude may legitimately return placeholder text (e.g. "[●]", "TBD",
 *   "Not specified in the document") for unfilled legal templates instead
 *   of a real date/term, and that text must never crash date/number
 *   parsing below.
 */
export type PortfolioLeaseAbstract = {
  landlordName?: string | null
  tenantName?: string | null
  premisesAddress?: string | null
  contractualTerm?: string | null
  commencementDate?: string | null
  expirationDate?: string | null
  initialBaseRent?: string | null
  rentReviewDetails?: string | null
  camServiceChargeTerms?: string | null
  terminationAndBreakClauses?: string[] | null
  keyObligationsAndRestrictions?: string[] | null
}

export type PortfolioLeaseRow = {
  id: string
  file_name: string
  abstract_data: PortfolioLeaseAbstract | null
  /** Only present/needed when a caller (e.g. the cron route) selects it explicitly. */
  user_id?: string
}

const PLACEHOLDER_PATTERN =
  /\[.*?\]|●|not specified|not available|n\/a|tbd|to be (confirmed|determined|agreed)|unknown/i

const ORDINAL_SUFFIX_PATTERN = /(\d+)(st|nd|rd|th)\b/gi

/** True if a value is empty or looks like an unfilled template placeholder. */
const isPlaceholder = (value: string | null | undefined): boolean =>
  !value || !value.trim() || PLACEHOLDER_PATTERN.test(value)

/**
 * Best-effort date parser for the free-text date fields Claude extracts
 * from lease PDFs (e.g. "1st January 2030", "2030-01-01"). Never throws —
 * returns null for placeholders or anything the JS Date constructor can't
 * make sense of.
 */
export const parseLeaseDate = (
  value: string | null | undefined
): Date | null => {
  if (isPlaceholder(value)) return null

  const normalized = value!.trim().replace(ORDINAL_SUFFIX_PATTERN, "$1")
  const parsed = new Date(normalized)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Extracts a whole/fractional number of years from a term string like
 * "10 years", "5-year term", or "2.5 years". Returns null if no such
 * pattern is found or the string is a placeholder.
 */
export const parseTermYears = (
  value: string | null | undefined
): number | null => {
  if (isPlaceholder(value)) return null

  const match = value!.match(/(\d+(?:\.\d+)?)\s*-?\s*year/i)
  if (!match) return null

  const years = Number.parseFloat(match[1])
  return Number.isFinite(years) && years > 0 ? years : null
}

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25

/**
 * Resolves a single lease's term length in years: tries the stated
 * contractual term first, then falls back to (expiration - commencement).
 * Returns null if neither can be determined (e.g. both are placeholders),
 * so callers can skip the record rather than let it skew the average.
 */
export const getLeaseTermYears = (
  abstract: PortfolioLeaseAbstract
): number | null => {
  const fromTerm = parseTermYears(abstract.contractualTerm)
  if (fromTerm != null) return fromTerm

  const commencement = parseLeaseDate(abstract.commencementDate)
  const expiration = parseLeaseDate(abstract.expirationDate)

  if (
    commencement &&
    expiration &&
    expiration.getTime() > commencement.getTime()
  ) {
    return (expiration.getTime() - commencement.getTime()) / MS_PER_YEAR
  }

  return null
}

export type CriticalDateEntry = {
  id: string
  fileName: string
  tenantName: string | null
  expirationDate: Date
  rentReviewDetails: string | null
}

export type PortfolioMetrics = {
  totalLeases: number
  upcomingExpirations: number
  /** Equal-weighted average lease term in years, or null if no lease had a parseable term/dates. */
  waltYears: number | null
  /** Leases where neither the term string nor the two dates could be parsed. */
  needsReviewCount: number
  /** Soonest-first, capped to the top 3, upcoming (not-yet-expired) leases. */
  criticalDates: CriticalDateEntry[]
}

const UPCOMING_WINDOW_MONTHS = 24
const CRITICAL_DATES_LIMIT = 3

// --- Lifecycle alerts (shared by the notification bell and the daily cron job) ---

export type LeaseAlertType = "expiration" | "rent_review"

export type LeaseAlert = {
  /** Unique per-alert id, suitable for a React `key` (one lease can produce two alerts). */
  id: string
  /** The `lease_abstracts.id` this alert was derived from. */
  recordId: string
  fileName: string
  tenantName: string | null
  type: LeaseAlertType
  date: Date
  daysUntil: number
  /** Pre-formatted, human-readable summary, e.g. "Acme Co expiration in 45 days". */
  message: string
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)

const pluralizeDays = (days: number) => `${days} day${days === 1 ? "" : "s"}`

/**
 * Scans every record's `expirationDate` and `rentReviewDetails` for dates
 * that fall within `windowDays` from `now` (inclusive, never in the past).
 *
 * `rentReviewDetails` is free text (e.g. "CPI-linked review each 1
 * January"), not a guaranteed date, so it's a best-effort parse via the
 * same placeholder-safe `parseLeaseDate` used everywhere else — if it
 * doesn't contain a parseable date, it's silently skipped rather than
 * treated as an error.
 *
 * This is the single source of truth for "what counts as a lifecycle
 * alert," shared by components/dashboard/notification-bell.tsx (client)
 * and app/api/cron/alerts/route.ts (server), so the two surfaces can never
 * drift out of sync.
 */
export const getUpcomingLeaseAlerts = (
  records: PortfolioLeaseRow[],
  windowDays = 90,
  now: Date = new Date()
): LeaseAlert[] => {
  const alerts: LeaseAlert[] = []

  for (const record of records) {
    const abstract = record.abstract_data ?? {}
    const tenantName = isPlaceholder(abstract.tenantName)
      ? null
      : (abstract.tenantName ?? null)
    const label = tenantName ?? record.file_name

    const expiration = parseLeaseDate(abstract.expirationDate)
    if (expiration) {
      const daysUntil = daysBetween(now, expiration)
      if (daysUntil >= 0 && daysUntil <= windowDays) {
        alerts.push({
          id: `${record.id}:expiration`,
          recordId: record.id,
          fileName: record.file_name,
          tenantName,
          type: "expiration",
          date: expiration,
          daysUntil,
          message: `${label} expiration in ${pluralizeDays(daysUntil)}`,
        })
      }
    }

    const rentReview = parseLeaseDate(abstract.rentReviewDetails)
    if (rentReview) {
      const daysUntil = daysBetween(now, rentReview)
      if (daysUntil >= 0 && daysUntil <= windowDays) {
        alerts.push({
          id: `${record.id}:rent_review`,
          recordId: record.id,
          fileName: record.file_name,
          tenantName,
          type: "rent_review",
          date: rentReview,
          daysUntil,
          message: `${label} rent review in ${pluralizeDays(daysUntil)}`,
        })
      }
    }
  }

  alerts.sort((a, b) => a.date.getTime() - b.date.getTime())
  return alerts
}

/** The day-counts the daily cron job fires alerts at — 90/60/30 days out. */
export const CRON_ALERT_THRESHOLDS_DAYS = [90, 60, 30] as const

/**
 * Same underlying parsing as `getUpcomingLeaseAlerts`, but filtered down to
 * the exact day-count thresholds the cron job cares about, so it fires
 * once per lease per threshold (day 90, day 60, day 30) instead of once
 * per day for the entire window — that de-duplication matters once this is
 * wired to a real email provider.
 */
export const getExactThresholdLeaseAlerts = (
  records: PortfolioLeaseRow[],
  thresholds: readonly number[] = CRON_ALERT_THRESHOLDS_DAYS,
  now: Date = new Date()
): LeaseAlert[] => {
  const maxWindow = Math.max(...thresholds)
  return getUpcomingLeaseAlerts(records, maxWindow, now).filter((alert) =>
    thresholds.includes(alert.daysUntil)
  )
}

export const calculatePortfolioMetrics = (
  records: PortfolioLeaseRow[]
): PortfolioMetrics => {
  const now = new Date()
  const windowEnd = new Date(now)
  windowEnd.setMonth(windowEnd.getMonth() + UPCOMING_WINDOW_MONTHS)

  let upcomingExpirations = 0
  let needsReviewCount = 0
  const termYears: number[] = []
  const criticalDates: CriticalDateEntry[] = []

  for (const record of records) {
    const abstract = record.abstract_data ?? {}

    const term = getLeaseTermYears(abstract)
    if (term != null) {
      termYears.push(term)
    } else {
      needsReviewCount += 1
    }

    const expiration = parseLeaseDate(abstract.expirationDate)
    if (!expiration || expiration.getTime() < now.getTime()) {
      continue
    }

    if (expiration.getTime() <= windowEnd.getTime()) {
      upcomingExpirations += 1
    }

    criticalDates.push({
      id: record.id,
      fileName: record.file_name,
      tenantName: isPlaceholder(abstract.tenantName)
        ? null
        : (abstract.tenantName ?? null),
      expirationDate: expiration,
      rentReviewDetails: isPlaceholder(abstract.rentReviewDetails)
        ? null
        : (abstract.rentReviewDetails ?? null),
    })
  }

  criticalDates.sort(
    (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime()
  )

  const waltYears =
    termYears.length > 0
      ? termYears.reduce((sum, years) => sum + years, 0) / termYears.length
      : null

  return {
    totalLeases: records.length,
    upcomingExpirations,
    waltYears,
    needsReviewCount,
    criticalDates: criticalDates.slice(0, CRITICAL_DATES_LIMIT),
  }
}

// --- Risk breakdown & expiration timeline (Analytics page) ---

export type RiskCategory = "critical" | "upcoming" | "healthy" | "needs_review"

const CRITICAL_RISK_WINDOW_DAYS = 90
const UPCOMING_RISK_WINDOW_DAYS = 730 // ~24 months, matches UPCOMING_WINDOW_MONTHS

/**
 * Buckets a single lease by how urgently its expiration needs attention.
 * Distinct from `PortfolioMetrics.needsReviewCount` above (which is about
 * whether a *lease term* was parseable) — this is specifically about
 * whether we know *when* the lease expires. A lease can have a perfectly
 * parseable 10-year term but a placeholder expiration date, and vice
 * versa; each metric answers a different question.
 */
export const categorizeLeaseExpirationRisk = (
  expirationDate: Date | null,
  now: Date = new Date()
): RiskCategory => {
  if (!expirationDate) return "needs_review"

  const daysUntil = daysBetween(now, expirationDate)
  if (daysUntil <= CRITICAL_RISK_WINDOW_DAYS) return "critical"
  if (daysUntil <= UPCOMING_RISK_WINDOW_DAYS) return "upcoming"
  return "healthy"
}

export type RiskBreakdownEntry = {
  category: RiskCategory
  label: string
  count: number
}

const RISK_LABELS: Record<RiskCategory, string> = {
  critical: "Critical (≤90 days or overdue)",
  upcoming: "Upcoming (≤24 months)",
  healthy: "Healthy (>24 months)",
  needs_review: "Needs review (no parseable expiration)",
}

/** Counts every lease into exactly one risk category, in a fixed, chart-friendly order. */
export const getRiskBreakdown = (
  records: PortfolioLeaseRow[],
  now: Date = new Date()
): RiskBreakdownEntry[] => {
  const counts: Record<RiskCategory, number> = {
    critical: 0,
    upcoming: 0,
    healthy: 0,
    needs_review: 0,
  }

  for (const record of records) {
    const abstract = record.abstract_data ?? {}
    const expiration = parseLeaseDate(abstract.expirationDate)
    counts[categorizeLeaseExpirationRisk(expiration, now)] += 1
  }

  return (
    ["critical", "upcoming", "healthy", "needs_review"] as const
  ).map((category) => ({
    category,
    label: RISK_LABELS[category],
    count: counts[category],
  }))
}

export type ExpirationTimelineBucket = {
  label: string
  minMonths: number
  maxMonths: number | null
  count: number
}

const EXPIRATION_TIMELINE_BUCKET_DEFS: Array<
  Pick<ExpirationTimelineBucket, "label" | "minMonths" | "maxMonths">
> = [
  { label: "0–6 months", minMonths: 0, maxMonths: 6 },
  { label: "6–12 months", minMonths: 6, maxMonths: 12 },
  { label: "12–24 months", minMonths: 12, maxMonths: 24 },
  { label: "24+ months", minMonths: 24, maxMonths: null },
]

const AVG_DAYS_PER_MONTH = 30.44

/**
 * Distributes upcoming (not-yet-expired) leases into fixed 0–6 / 6–12 /
 * 12–24 / 24+ month buckets by time-to-expiration. Leases with no
 * parseable expiration date, and already-expired leases, are excluded —
 * this is a forward-looking timeline, not a full accounting of every row
 * (see `getRiskBreakdown` for those).
 */
export const getExpirationTimelineBuckets = (
  records: PortfolioLeaseRow[],
  now: Date = new Date()
): ExpirationTimelineBucket[] => {
  const buckets = EXPIRATION_TIMELINE_BUCKET_DEFS.map((def) => ({
    ...def,
    count: 0,
  }))

  for (const record of records) {
    const abstract = record.abstract_data ?? {}
    const expiration = parseLeaseDate(abstract.expirationDate)
    if (!expiration) continue

    const daysUntil = daysBetween(now, expiration)
    if (daysUntil < 0) continue

    const monthsUntil = daysUntil / AVG_DAYS_PER_MONTH
    const bucket = buckets.find(
      (candidate) =>
        monthsUntil >= candidate.minMonths &&
        (candidate.maxMonths === null || monthsUntil < candidate.maxMonths)
    )
    if (bucket) bucket.count += 1
  }

  return buckets
}

// --- Tenant aggregation (Customers page) ---

export type TenantSummary = {
  tenantName: string
  /** Leases with no parseable expiration date, or one that's still in the future. */
  activeLeaseCount: number
  totalLeaseCount: number
  premisesAddresses: string[]
  nearestExpiration: Date | null
  riskCategory: RiskCategory
}

/**
 * Groups every lease by tenant name (best-effort — Claude's free-text
 * extraction, not a normalized foreign key) and rolls up per-tenant
 * counts, known premises, and the soonest expiration across their
 * leases. Leases with an unparseable/placeholder tenant name are grouped
 * under a synthetic "Unnamed tenant (<file name>)" bucket per file, so
 * they're still visible rather than silently dropped or wrongly merged
 * with an actual named tenant.
 *
 * Note: the lease abstraction schema (app/api/lease/schema.ts) does not
 * currently capture square footage / floor area for the leased premises,
 * so it cannot be included here — callers should render that column as
 * "Not tracked" rather than inventing a value.
 */
export const getTenantSummaries = (
  records: PortfolioLeaseRow[],
  now: Date = new Date()
): TenantSummary[] => {
  const byTenant = new Map<string, PortfolioLeaseRow[]>()

  for (const record of records) {
    const abstract = record.abstract_data ?? {}
    const tenantName = isPlaceholder(abstract.tenantName)
      ? null
      : abstract.tenantName!.trim()
    const key = tenantName ?? `Unnamed tenant (${record.file_name})`

    const existing = byTenant.get(key)
    if (existing) {
      existing.push(record)
    } else {
      byTenant.set(key, [record])
    }
  }

  const summaries: TenantSummary[] = []

  for (const [tenantName, leases] of byTenant) {
    const addresses = new Set<string>()
    let activeLeaseCount = 0
    let nearestExpiration: Date | null = null

    for (const lease of leases) {
      const abstract = lease.abstract_data ?? {}

      if (!isPlaceholder(abstract.premisesAddress)) {
        addresses.add(abstract.premisesAddress!.trim())
      }

      const expiration = parseLeaseDate(abstract.expirationDate)
      const isActive = !expiration || daysBetween(now, expiration) >= 0
      if (isActive) activeLeaseCount += 1

      if (
        expiration &&
        (!nearestExpiration || expiration.getTime() < nearestExpiration.getTime())
      ) {
        nearestExpiration = expiration
      }
    }

    summaries.push({
      tenantName,
      activeLeaseCount,
      totalLeaseCount: leases.length,
      premisesAddresses: [...addresses],
      nearestExpiration,
      riskCategory: categorizeLeaseExpirationRisk(nearestExpiration, now),
    })
  }

  return summaries.sort((a, b) => a.tenantName.localeCompare(b.tenantName))
}
