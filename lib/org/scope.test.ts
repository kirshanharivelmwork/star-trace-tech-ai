import { describe, expect, it } from "vitest"

import {
  canManageOrgWithRole,
  canWriteWithRole,
  normalizeEmail,
  resolveActiveMembership,
} from "@/lib/org/scope"

describe("org roles", () => {
  it("treats viewers as read-only", () => {
    expect(canWriteWithRole("viewer")).toBe(false)
    expect(canManageOrgWithRole("viewer")).toBe(false)
    expect(canWriteWithRole("member")).toBe(true)
    expect(canManageOrgWithRole("admin")).toBe(true)
  })
})

describe("resolveActiveMembership", () => {
  it("prefers the cookie org when the user belongs to it", () => {
    const memberships = [
      { orgId: "a", orgName: "A" },
      { orgId: "b", orgName: "B" },
    ]
    expect(resolveActiveMembership(memberships, "b")?.orgId).toBe("b")
    expect(resolveActiveMembership(memberships, "missing")?.orgId).toBe("a")
  })
})

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ada@Firm.com ")).toBe("ada@firm.com")
  })
})
