import { describe, expect, it } from "vitest"

import {
  categorizeLeaseExpirationRisk,
  parseLeaseDate,
  parseMonthlyRent,
  parseNoticeDeadlines,
  parseSquareFootage,
  parseTermYears,
  resolveCronThreshold,
} from "@/lib/lease/portfolio-metrics"

describe("parseLeaseDate", () => {
  it("parses ISO and ordinal dates", () => {
    expect(parseLeaseDate("2030-01-01")?.getFullYear()).toBe(2030)
    expect(parseLeaseDate("1st January 2030")?.getFullYear()).toBe(2030)
  })

  it("returns null for placeholders", () => {
    expect(parseLeaseDate("[●]")).toBeNull()
    expect(parseLeaseDate("TBD")).toBeNull()
    expect(parseLeaseDate("Not specified in the document")).toBeNull()
  })
})

describe("parseMonthlyRent", () => {
  it("converts annual rent to monthly", () => {
    expect(parseMonthlyRent("$120,000/year")).toBe(10000)
  })

  it("keeps monthly amounts monthly", () => {
    expect(parseMonthlyRent(8500, "monthly")).toBe(8500)
  })
})

describe("parseSquareFootage", () => {
  it("reads numbers from free text", () => {
    expect(parseSquareFootage("12,500 RSF")).toBe(12500)
    expect(parseSquareFootage(8000)).toBe(8000)
  })
})

describe("parseTermYears", () => {
  it("extracts years from a term string", () => {
    expect(parseTermYears("10 years")).toBe(10)
  })
})

describe("parseNoticeDeadlines", () => {
  it("skips unparseable dates", () => {
    expect(
      parseNoticeDeadlines({
        noticeDeadlines: [{ label: "Break", targetDate: "TBD", noticeDays: 180 }],
      })
    ).toEqual([])
  })

  it("keeps ISO deadlines", () => {
    const parsed = parseNoticeDeadlines({
      noticeDeadlines: [
        { label: "Break", targetDate: "2028-06-01", noticeDays: 180 },
      ],
    })
    expect(parsed[0]?.targetDate).toBe("2028-06-01")
    expect(parsed[0]?.noticeDays).toBe(180)
  })
})

describe("categorizeLeaseExpirationRisk", () => {
  it("flags missing dates as needs_review", () => {
    expect(categorizeLeaseExpirationRisk(null)).toBe("needs_review")
  })
})

describe("resolveCronThreshold", () => {
  it("fires exactly on the 90/60/30 day thresholds", () => {
    expect(resolveCronThreshold(90)).toBe(90)
    expect(resolveCronThreshold(60)).toBe(60)
    expect(resolveCronThreshold(30)).toBe(30)
  })

  it("keeps an alert due for the retry grace window after a threshold", () => {
    expect(resolveCronThreshold(89)).toBe(90)
    expect(resolveCronThreshold(88)).toBe(90)
    expect(resolveCronThreshold(58)).toBe(60)
    expect(resolveCronThreshold(28)).toBe(30)
  })

  it("returns null outside every window", () => {
    expect(resolveCronThreshold(91)).toBeNull()
    expect(resolveCronThreshold(87)).toBeNull()
    expect(resolveCronThreshold(75)).toBeNull()
    expect(resolveCronThreshold(61)).toBeNull()
    expect(resolveCronThreshold(27)).toBeNull()
    expect(resolveCronThreshold(0)).toBeNull()
  })
})
