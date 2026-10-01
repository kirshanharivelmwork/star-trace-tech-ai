import { describe, expect, it } from "vitest"

import {
  calculateWaltYears,
  classifyRenewalRisk,
  isActiveLease,
  quarterlyExpirationFunnel,
} from "@/lib/telemetry/metrics"
import type { LeaseRow } from "@/lib/telemetry/types"

const lease = (overrides: Partial<LeaseRow>): LeaseRow => ({
  id: "1",
  property_id: "p1",
  tenant_name: "Acme",
  status: "active",
  start_date: "2024-01-01",
  end_date: "2028-01-01",
  square_footage: 1000,
  monthly_rent: 5000,
  created_at: "2024-01-01",
  ...overrides,
})

describe("isActiveLease", () => {
  it("treats expired status as inactive", () => {
    expect(
      isActiveLease(lease({ status: "expired" }), new Date("2026-01-01"))
    ).toBe(false)
  })
})

describe("calculateWaltYears", () => {
  it("weights remaining term by square footage", () => {
    const now = new Date("2026-01-01")
    const walt = calculateWaltYears(
      [
        lease({ id: "a", square_footage: 1000, end_date: "2028-01-01" }),
        lease({ id: "b", square_footage: 3000, end_date: "2027-01-01" }),
      ],
      now
    )
    expect(walt).not.toBeNull()
    expect(walt ?? 0).toBeGreaterThan(0)
  })
})

describe("classifyRenewalRisk", () => {
  it("maps labels and scores", () => {
    expect(classifyRenewalRisk("critical", null)).toBe("high")
    expect(classifyRenewalRisk("safe", null)).toBe("safe")
    expect(classifyRenewalRisk(null, 0.8)).toBe("high")
  })
})

describe("quarterlyExpirationFunnel", () => {
  it("buckets into four quarters", () => {
    const buckets = quarterlyExpirationFunnel([], new Date("2026-01-15"))
    expect(buckets).toHaveLength(4)
  })
})
