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
export type PortfolioNoticeDeadline = {
  label?: string | null
  targetDate?: string | null
  noticeDays?: number | null
}

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
  premisesSquareFootage?: number | string | null
  monthlyBaseRentAmount?: number | string | null
  rentPaymentFrequency?: string | null
  propertyName?: string | null
  noticeDeadlines?: PortfolioNoticeDeadline[] | null
  discountRateAnnual?: number | string | null
}

export type PortfolioLeaseRow = {
  id: string
  file_name: string
  abstract_data: PortfolioLeaseAbstract | null
  /** Only present/needed when a caller (e.g. the cron route) selects it explicitly. */
  user_id?: string
  organization_id?: string | null
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

/** Calendar date as YYYY-MM-DD, or null. */
export const toIsoDateString = (date: Date | null): string | null => {
  if (!date) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const normalizeMatchKey = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ")

/**
 * Best-effort square footage from a number or free-text phrase
 * ("12,500 RSF", "approximately 8,000 sq ft").
 */
export const parseSquareFootage = (
  value: string | number | null | undefined
): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value !== "string" || isPlaceholder(value)) return null

  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sf|rsf|nra)?/i)
  if (!match) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

/**
 * Always returns a monthly USD/GBP-style numeric rent. Annual / yearly
 * figures are divided by 12; quarterly by 4; weekly × 52 / 12.
 */
export const parseMonthlyRent = (
  amount: string | number | null | undefined,
  frequency?: string | null
): number | null => {
  const haystack = [
    typeof amount === "number" ? String(amount) : (amount ?? ""),
    frequency ?? "",
  ]
    .join(" ")
    .toLowerCase()

  let numeric: number | null = null
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    numeric = amount
  } else if (typeof amount === "string" && !isPlaceholder(amount)) {
    const match = amount.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/)
    if (match) {
      const parsed = Number.parseFloat(match[1])
      if (Number.isFinite(parsed) && parsed > 0) numeric = parsed
    }
  }

  if (numeric == null) return null

  const isAnnual = /per\s*annum|\/\s*year|annual|yearly|p\.?a\.?/i.test(haystack)
  const isQuarterly = /quarter/i.test(haystack)
  const isWeekly = /week/i.test(haystack)
  const isDaily = /day|daily/i.test(haystack)

  if (isAnnual) return Math.round((numeric / 12) * 100) / 100
  if (isQuarterly) return Math.round((numeric / 3) * 100) / 100
  if (isWeekly) return Math.round(((numeric * 52) / 12) * 100) / 100
  if (isDaily) return Math.round((numeric * 365.25) / 12 * 100) / 100
  return Math.round(numeric * 100) / 100
}

export const parseAnnualRate = (
  value: string | number | null | undefined
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1 ? value / 100 : value
  }
  if (typeof value !== "string" || isPlaceholder(value)) return null
  const match = value.replace(/%/g, "").match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = Number.parseFloat(match[1])
  if (!Number.isFinite(parsed)) return null
  return parsed > 1 ? parsed / 100 : parsed
}

export type ParsedNoticeDeadline = {
  label: string
  targetDate: string
  noticeDays: number | null
}

export const parseNoticeDeadlines = (
  abstract: PortfolioLeaseAbstract
): ParsedNoticeDeadline[] => {
  const results: ParsedNoticeDeadline[] = []
  const seen = new Set<string>()

  const push = (label: string, date: Date | null, noticeDays: number | null) => {
    const iso = toIsoDateString(date)
    if (!iso) return
    const key = `${iso}:${label.trim().toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    results.push({
      label: label.trim() || "Notice deadline",
      targetDate: iso,
      noticeDays,
    })
  }

  for (const deadline of abstract.noticeDeadlines ?? []) {
    const date = parseLeaseDate(deadline.targetDate)
    const days =
      typeof deadline.noticeDays === "number" && Number.isFinite(deadline.noticeDays)
        ? Math.round(deadline.noticeDays)
        : null
    push(deadline.label ?? "Notice deadline", date, days)
  }

  for (const clause of abstract.terminationAndBreakClauses ?? []) {
    if (isPlaceholder(clause)) continue
    const date = parseLeaseDate(clause)
    const daysMatch = clause.match(/(\d+)\s*-?\s*day/i)
    const days = daysMatch ? Number.parseInt(daysMatch[1], 10) : null
    push(clause.slice(0, 80), date, Number.isFinite(days) ? days : null)
  }

  const rentReview = parseLeaseDate(abstract.rentReviewDetails)
  if (rentReview) {
    push("Rent review", rentReview, null)
  }

  return results
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

/**
 * How many days after a threshold (90/60/30) an alert is still considered
 * "due". Without this, a failed send on day 90 could never be retried: the
 * next cron run sees 89 days and matches nothing. Dispatch de-duplication is
 * keyed on the threshold (not the actual day count), so a retry that
 * succeeds is still sent at most once per threshold.
 */
export const CRON_RETRY_GRACE_DAYS = 3

/**
 * Maps a day-count to the cron threshold it belongs to, or null if it is
 * outside every threshold's [threshold - grace + 1, threshold] window.
 * e.g. with thresholds 90/60/30 and grace 3: 90, 89, 88 -> 90; 87 -> null.
 */
export const resolveCronThreshold = (
  daysUntil: number,
  thresholds: readonly number[] = CRON_ALERT_THRESHOLDS_DAYS,
  graceDays: number = CRON_RETRY_GRACE_DAYS
): number | null => {
  const ascending = [...thresholds].sort((a, b) => a - b)
  const threshold = ascending.find((t) => daysUntil <= t)
  if (threshold === undefined) return null
  return daysUntil > threshold - graceDays ? threshold : null
}

export type CronDueLeaseAlert = LeaseAlert & { thresholdDays: number }

/** Alerts due today under the threshold + retry-grace rules above. */
export const getCronDueLeaseAlerts = (
  records: PortfolioLeaseRow[],
  now: Date = new Date(),
  thresholds: readonly number[] = CRON_ALERT_THRESHOLDS_DAYS,
  graceDays: number = CRON_RETRY_GRACE_DAYS
): CronDueLeaseAlert[] => {
  const maxWindow = Math.max(...thresholds)
  return getUpcomingLeaseAlerts(records, maxWindow, now).flatMap((alert) => {
    const thresholdDays = resolveCronThreshold(
      alert.daysUntil,
      thresholds,
      graceDays
    )
    return thresholdDays === null ? [] : [{ ...alert, thresholdDays }]
  })
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
  /** Sum of known square footage across this tenant's leases; null if none. */
  squareFootage: number | null
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
    let squareFootageSum = 0
    let hasSquareFootage = false

    for (const lease of leases) {
      const abstract = lease.abstract_data ?? {}

      if (!isPlaceholder(abstract.premisesAddress)) {
        addresses.add(abstract.premisesAddress!.trim())
      }

      const sf = parseSquareFootage(abstract.premisesSquareFootage)
      if (sf != null) {
        squareFootageSum += sf
        hasSquareFootage = true
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
      squareFootage: hasSquareFootage ? squareFootageSum : null,
      nearestExpiration,
      riskCategory: categorizeLeaseExpirationRisk(nearestExpiration, now),
    })
  }

  return summaries.sort((a, b) => a.tenantName.localeCompare(b.tenantName))
}
