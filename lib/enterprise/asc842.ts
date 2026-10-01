import { roundCents } from "@/lib/enterprise/metrics"
import type {
  AmortizationRow,
  LeaseAccountingInputs,
  LeaseDisclosureSchedule,
  LeasePaymentTerm,
  LeasePresentation,
} from "@/lib/enterprise/types"

export const DEFAULT_ANNUAL_RATE = 0.05

export const defaultAccountingInputs = (
  overrides: Partial<LeaseAccountingInputs> = {}
): LeaseAccountingInputs => ({
  incrementalBorrowingRate: DEFAULT_ANNUAL_RATE,
  initialDirectCosts: 0,
  prepaidRent: 0,
  leaseIncentives: 0,
  presentation: "finance",
  ...overrides,
})

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

const asPresentation = (value: string | null | undefined): LeasePresentation =>
  value === "operating" ? "operating" : "finance"

/**
 * Simplified monthly ordinary annuity (not audited GAAP).
 *
 * Liability initial = PV of remaining payments only.
 * ROU initial = PV + initial direct costs + prepaid rent − lease incentives.
 * Each period: interest on outstanding liability, principal, straight-line
 * ROU amortization. Last period zeros both balances.
 *
 * Presentation is a user-selected P&L flag, not an auto-classification
 * under the five ASC 842 tests:
 *   finance  → interest + amortization
 *   operating → straight-line lease expense
 */
export const buildLeaseDisclosureSchedule = (
  term: LeasePaymentTerm,
  now: Date = new Date()
): LeaseDisclosureSchedule => {
  const inputs = defaultAccountingInputs(term.accounting)
  const periods = Math.max(0, term.remainingMonths)
  const rate =
    inputs.incrementalBorrowingRate < 0 ? 0 : inputs.incrementalBorrowingRate
  const monthlyRate = rate / 12
  const payment = roundCents(term.monthlyPayment)
  const idc = roundCents(Math.max(0, inputs.initialDirectCosts))
  const prepaid = roundCents(Math.max(0, inputs.prepaidRent))
  const incentives = roundCents(Math.max(0, inputs.leaseIncentives))
  const presentation = asPresentation(inputs.presentation)

  const pvRemaining = presentValueOfAnnuity(payment, periods, monthlyRate)
  const initialLiability = pvRemaining
  const initialRou = roundCents(Math.max(0, pvRemaining + idc + prepaid - incentives))
  const depreciation = periods > 0 ? roundCents(initialRou / periods) : 0

  const totalOperatingCost = roundCents(payment * periods + idc - incentives)
  const straightLineExpense =
    periods > 0 ? roundCents(totalOperatingCost / periods) : 0

  const rows: AmortizationRow[] = []
  let liability = initialLiability
  let rou = initialRou
  let operatingAllocated = 0

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

    const financeExpense = roundCents(interest + thisDepreciation)
    let operatingExpense = isLast
      ? roundCents(totalOperatingCost - operatingAllocated)
      : straightLineExpense
    if (isLast && operatingExpense < 0) operatingExpense = 0
    operatingAllocated = roundCents(operatingAllocated + operatingExpense)

    rows.push({
      period,
      dateIso: isoDate(addMonths(now, period)),
      payment: isLast ? roundCents(principal + interest) : payment,
      interest,
      principal,
      endingLiability: liability,
      depreciation: thisDepreciation,
      endingRou: rou,
      financeExpense,
      operatingExpense,
      periodExpense:
        presentation === "operating" ? operatingExpense : financeExpense,
    })
  }

  const financeExpenseTotal = roundCents(
    rows.reduce((sum, row) => sum + row.financeExpense, 0)
  )
  const operatingExpenseTotal = roundCents(
    rows.reduce((sum, row) => sum + row.operatingExpense, 0)
  )

  return {
    leaseId: term.leaseId,
    tenantName: term.tenantName,
    propertyName: term.propertyName,
    monthlyPayment: payment,
    remainingMonths: periods,
    annualRate: rate,
    initialLiability,
    initialRou,
    undiscountedRemaining: roundCents(payment * periods),
    initialDirectCosts: idc,
    prepaidRent: prepaid,
    leaseIncentives: incentives,
    presentation,
    financeExpenseTotal,
    operatingExpenseTotal,
    rows,
  }
}

export const buildPortfolioDisclosure = (
  terms: LeasePaymentTerm[],
  now: Date = new Date()
): LeaseDisclosureSchedule[] =>
  terms
    .filter((term) => term.monthlyPayment > 0 && term.remainingMonths > 0)
    .map((term) => buildLeaseDisclosureSchedule(term, now))
