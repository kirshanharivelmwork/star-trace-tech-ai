import { describe, expect, it } from "vitest"

import {
  classifyNoticePriority,
  prorateOperatingExpense,
  remainingWholeMonths,
  roundCents,
} from "@/lib/enterprise/metrics"

describe("prorateOperatingExpense", () => {
  it("allocates by square footage and plugs drift on the last tenant", () => {
    const shares = prorateOperatingExpense({
      amount: 100.01,
      propertyNra: 1000,
      leases: [
        { id: "a", squareFootage: 600 },
        { id: "b", squareFootage: 400 },
      ],
    })
    expect(shares[0]?.allocatedAmount).toBe(60.01)
    expect(shares[1]?.allocatedAmount).toBe(40)
    expect(roundCents(shares.reduce((sum, row) => sum + row.allocatedAmount, 0))).toBe(
      100.01
    )
  })

  it("splits equally when SF is missing", () => {
    const shares = prorateOperatingExpense({
      amount: 90,
      propertyNra: null,
      leases: [
        { id: "a", squareFootage: null },
        { id: "b", squareFootage: null },
      ],
    })
    expect(shares.map((row) => row.allocatedAmount)).toEqual([45, 45])
  })
})

describe("classifyNoticePriority", () => {
  it("maps 90/60/30 windows", () => {
    expect(classifyNoticePriority(90)).toBe("watch")
    expect(classifyNoticePriority(60)).toBe("high")
    expect(classifyNoticePriority(30)).toBe("critical")
  })
})

describe("remainingWholeMonths", () => {
  it("returns 0 when the end date is not in the future", () => {
    const now = new Date(2026, 0, 15)
    expect(remainingWholeMonths(new Date(2026, 0, 15), now)).toBe(0)
  })
})
