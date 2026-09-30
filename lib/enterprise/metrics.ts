import { toNumber } from "@/lib/telemetry/metrics"
import type { NoticePriority } from "@/lib/enterprise/types"

const MS_PER_DAY = 1000 * 60 * 60 * 24

/** Parse a date-only ISO string as local calendar date (avoids UTC off-by-one). */
export const parseIsoDate = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const calendarDaysUntil = (target: Date, now: Date = new Date()): number => {
  const delta =
    startOfLocalDay(target).getTime() - startOfLocalDay(now).getTime()
  return Math.round(delta / MS_PER_DAY)
}

export const classifyNoticePriority = (daysUntil: number): NoticePriority => {
  if (daysUntil <= 30) return "critical"
  if (daysUntil <= 60) return "high"
  return "watch"
}

export const roundCents = (value: number): number =>
  Math.round(value * 100) / 100

export type ProrationLease = {
  id: string
  squareFootage: number | null
}

export type ProrationShare = {
  leaseId: string
  share: number
  allocatedAmount: number
}

/**
 * Prorate a building OpEx amount across tenants by square-footage ratio.
 * Denominator prefers property NRA; falls back to the sum of lease SF, then
 * an equal split so a missing NRA never silently drops the allocation.
 */
export const prorateOperatingExpense = (params: {
  amount: number
  propertyNra: number | null
  leases: ProrationLease[]
}): ProrationShare[] => {
  const { amount, propertyNra, leases } = params
  if (leases.length === 0 || !Number.isFinite(amount)) return []

  const sfByLease = leases.map((lease) => ({
    leaseId: lease.id,
    sf: lease.squareFootage != null && lease.squareFootage > 0 ? lease.squareFootage : 0,
  }))

  const sfSum = sfByLease.reduce((sum, row) => sum + row.sf, 0)
  const useEqual = sfSum === 0
  const denominator = useEqual
    ? leases.length
    : propertyNra != null && propertyNra > 0
      ? propertyNra
      : sfSum

  const shares = sfByLease.map((row) => {
    const share = useEqual ? 1 / leases.length : row.sf / denominator
    return {
      leaseId: row.leaseId,
      share,
      allocatedAmount: roundCents(amount * share),
    }
  })

  const allocatedSum = shares.reduce((sum, row) => sum + row.allocatedAmount, 0)
  const drift = roundCents(amount - allocatedSum)
  if (shares.length > 0 && drift !== 0) {
    const last = shares[shares.length - 1]
    last.allocatedAmount = roundCents(last.allocatedAmount + drift)
  }

  return shares
}

export const remainingWholeMonths = (
  endDate: Date,
  now: Date = new Date()
): number => {
  const start = startOfLocalDay(now)
  const end = startOfLocalDay(endDate)
  if (end.getTime() <= start.getTime()) return 0

  const years = end.getFullYear() - start.getFullYear()
  const months = end.getMonth() - start.getMonth()
  let total = years * 12 + months
  if (end.getDate() < start.getDate()) total -= 1
  return Math.max(0, total)
}

export const toMoney = (value: unknown): number | null => {
  const parsed = toNumber(value)
  if (parsed == null) return null
  return roundCents(parsed)
}
