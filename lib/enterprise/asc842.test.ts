import { describe, expect, it } from "vitest"

import {
  buildLeaseDisclosureSchedule,
  presentValueOfAnnuity,
} from "@/lib/enterprise/asc842"
import { defaultAccountingInputs } from "@/lib/enterprise/asc842"
import { roundCents } from "@/lib/enterprise/metrics"
import type { LeasePaymentTerm } from "@/lib/enterprise/types"

const term = (
  overrides: Partial<LeasePaymentTerm> = {},
  accounting: Partial<LeasePaymentTerm["accounting"]> = {}
): LeasePaymentTerm => ({
  leaseId: "lease-1",
  tenantName: "Acme",
  propertyName: "Tower",
  monthlyPayment: 1000,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  remainingMonths: 12,
  accounting: defaultAccountingInputs(accounting),
  ...overrides,
})

describe("presentValueOfAnnuity", () => {
  it("equals n * payment when the rate is 0", () => {
    expect(presentValueOfAnnuity(100, 10, 0)).toBe(1000)
  })
})

describe("buildLeaseDisclosureSchedule", () => {
  const now = new Date(2026, 0, 1)

  it("zeros liability and ROU in the last period", () => {
    const schedule = buildLeaseDisclosureSchedule(term(), now)
    const last = schedule.rows[schedule.rows.length - 1]
    expect(last?.endingLiability).toBe(0)
    expect(last?.endingRou).toBe(0)
  })

  it("sets ROU = PV + IDC + prepaid − incentives", () => {
    const schedule = buildLeaseDisclosureSchedule(
      term({}, { initialDirectCosts: 500, prepaidRent: 200, leaseIncentives: 100 }),
      now
    )
    const expectedRou = roundCents(
      schedule.initialLiability + 500 + 200 - 100
    )
    expect(schedule.initialRou).toBe(expectedRou)
    expect(schedule.initialLiability).toBe(
      presentValueOfAnnuity(1000, 12, 0.05 / 12)
    )
  })

  it("uses distinct finance vs operating expense totals", () => {
    const finance = buildLeaseDisclosureSchedule(
      term({}, { presentation: "finance", initialDirectCosts: 240 }),
      now
    )
    const operating = buildLeaseDisclosureSchedule(
      term({}, { presentation: "operating", initialDirectCosts: 240 }),
      now
    )
    expect(finance.financeExpenseTotal).not.toBe(operating.operatingExpenseTotal)
    expect(operating.rows.every((row) => row.periodExpense === row.operatingExpense)).toBe(
      true
    )
    expect(finance.rows.every((row) => row.periodExpense === row.financeExpense)).toBe(
      true
    )
  })
})
