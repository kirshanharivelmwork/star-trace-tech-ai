import { roundCents } from "@/lib/enterprise/metrics"
import type {
  AmortizationRow,
  LeaseDisclosureSchedule,
  LeasePaymentTerm,
} from "@/lib/enterprise/types"

const DEFAULT_ANNUAL_RATE = 0.05

/** Present value of an ordinary annuity: PMT × (1 − (1+r)^−n) / r. */
export const presentValueOfAnnuity = (
  payment: number,
  periods: number,
  periodicRate: number
): number => {
  if (periods <= 0 || payment === 0) return 0
  if (periodicRate === 0) return roundCents(payment * periods)
  const factor = (1 - Math.pow(1 + periodicRate, -periods)) / periodicRate
  return roundCents(payment * factor)
}

const addMonths = (date: Date, count: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + count, date.getDate())

const isoDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Lessee amortization under ASC 842 / IFRS 16 (simplified monthly):
 * initial liability = PV of remaining payments; ROU starts at the same
 * amount and depreciates straight-line. Interest accretes on the
 * outstanding liability each period.
 */
export const buildLeaseDisclosureSchedule = (
  term: LeasePaymentTerm,
  annualRate: number = DEFAULT_ANNUAL_RATE,
  now: Date = new Date()
): LeaseDisclosureSchedule => {
  const periods = Math.max(0, term.remainingMonths)
  const rate = annualRate < 0 ? 0 : annualRate
  const monthlyRate = rate / 12
  const payment = roundCents(term.monthlyPayment)
  const initialLiability = presentValueOfAnnuity(payment, periods, monthlyRate)
  const depreciation = periods > 0 ? roundCents(initialLiability / periods) : 0

  const rows: AmortizationRow[] = []
  let liability = initialLiability
  let rou = initialLiability

  for (let period = 1; period <= periods; period += 1) {
    const isLast = period === periods
    const interest = roundCents(liability * monthlyRate)
    let principal = roundCents(payment - interest)

    if (isLast) {
      principal = roundCents(liability)
    }

    liability = roundCents(Math.max(0, liability - principal))
    if (isLast) liability = 0

    const thisDepreciation = isLast ? roundCents(rou) : depreciation
    rou = roundCents(Math.max(0, rou - thisDepreciation))
    if (isLast) rou = 0

    rows.push({
      period,
      dateIso: isoDate(addMonths(now, period)),
      payment: isLast ? roundCents(principal + interest) : payment,
      interest,
      principal,
      endingLiability: liability,
      depreciation: thisDepreciation,
      endingRou: rou,
    })
  }

  return {
    leaseId: term.leaseId,
    tenantName: term.tenantName,
    propertyName: term.propertyName,
    monthlyPayment: payment,
    remainingMonths: periods,
    annualRate: rate,
    initialLiability,
    initialRou: initialLiability,
    undiscountedRemaining: roundCents(payment * periods),
    rows,
  }
}

export const buildPortfolioDisclosure = (
  terms: LeasePaymentTerm[],
  annualRate: number = DEFAULT_ANNUAL_RATE,
  now: Date = new Date()
): LeaseDisclosureSchedule[] =>
  terms
    .filter((term) => term.monthlyPayment > 0 && term.remainingMonths > 0)
    .map((term) => buildLeaseDisclosureSchedule(term, annualRate, now))
