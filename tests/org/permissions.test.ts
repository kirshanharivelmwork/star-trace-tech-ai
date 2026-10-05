import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createFakeSupabase,
  filterValue,
  type Call,
  type FakeSupabase,
  type QueryResult,
} from "../helpers/fake-supabase"
import type { OrgRole } from "@/lib/org/types"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  cookieValue: { current: undefined as string | undefined },
  cookieSet: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  client: { current: null as unknown },
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "starflow_org_id" && mocks.cookieValue.current
        ? { name, value: mocks.cookieValue.current }
        : undefined,
    set: mocks.cookieSet,
  }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mocks.client.current,
}))
// Imported transitively by lib/org/actions; none of them are exercised here.
vi.mock("@/lib/stripe/server", () => ({ stripe: {} }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client must not be used in these tests")
  },
}))
vi.mock("resend", () => ({ Resend: class {} }))
vi.mock("@/lib/audit/write", () => ({ writeAuditLog: vi.fn() }))

import { logOperatingExpense, updateLeaseAccountingInputs } from "@/app/finances/actions"
import { inviteOrgMember, switchActiveOrg } from "@/lib/org/actions"
import {
  getOrgContext,
  requireManageOrg,
  requireWritableOrg,
} from "@/lib/org/context"

const ORG_A = "org_a"
const ORG_B = "org_b"
const ORG_C = "org_c_not_mine"

type Membership = { orgId: string; name: string; role: OrgRole }

const installDb = (
  memberships: Membership[],
  tables?: (call: Call) => QueryResult | undefined
): FakeSupabase => {
  const db = createFakeSupabase((call): QueryResult => {
    if (call.table === "organization_members" && call.op === "select") {
      return {
        data: memberships.map((m) => ({
          org_id: m.orgId,
          role: m.role,
          organizations: { id: m.orgId, name: m.name },
        })),
      }
    }
    if (call.op === "rpc") return { data: null }
    return tables?.(call) ?? { data: null }
  })
  Object.assign(db, { auth: { getUser: mocks.getUser } })
  mocks.client.current = db
  return db
}

const formData = (fields: Record<string, string>) => {
  const data = new FormData()
  Object.entries(fields).forEach(([key, value]) => data.set(key, value))
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookieValue.current = undefined
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user_1", email: "u@example.com" } },
    error: null,
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
  installDb([{ orgId: ORG_A, name: "A", role: "owner" }])
})

describe("getOrgContext: role resolution", () => {
  it("returns null when signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await getOrgContext()).toBeNull()
  })

  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["member", true, false],
    ["viewer", false, false],
  ] as const)("%s: canWrite=%s canManageOrg=%s", async (role, canWrite, canManage) => {
    installDb([{ orgId: ORG_A, name: "A", role }])
    const context = await getOrgContext()
    expect(context?.role).toBe(role)
    expect(context?.canWrite).toBe(canWrite)
    expect(context?.canManageOrg).toBe(canManage)
  })

  it("uses getUser() for identity (verified), never getSession()", async () => {
    await getOrgContext()
    expect(mocks.getUser).toHaveBeenCalled()
  })
})

describe("cross-tenant access is denied", () => {
  it("ignores a tampered active-org cookie pointing at an org the user does not belong to", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "owner" }])
    mocks.cookieValue.current = ORG_C

    const context = await getOrgContext()

    expect(context?.orgId).toBe(ORG_A)
    expect(context?.orgId).not.toBe(ORG_C)
  })

  it("applies the role of the ACTIVE org: owner in A does not carry over to viewer in B", async () => {
    installDb([
      { orgId: ORG_A, name: "A", role: "owner" },
      { orgId: ORG_B, name: "B", role: "viewer" },
    ])
    mocks.cookieValue.current = ORG_B

    const context = await getOrgContext()

    expect(context?.orgId).toBe(ORG_B)
    expect(context?.canWrite).toBe(false)
    await expect(requireWritableOrg()).rejects.toThrow(/view-only/i)
  })

  it("switchActiveOrg refuses an org the user is not a member of and sets no cookie", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "owner" }])

    await expect(switchActiveOrg(ORG_C)).rejects.toThrow(/not a member/i)
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it("switchActiveOrg allows an org the user belongs to", async () => {
    installDb([
      { orgId: ORG_A, name: "A", role: "owner" },
      { orgId: ORG_B, name: "B", role: "member" },
    ])

    await switchActiveOrg(ORG_B)

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "starflow_org_id",
      ORG_B,
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    )
  })
})

describe("permission guards", () => {
  it("requireWritableOrg rejects viewers", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "viewer" }])
    await expect(requireWritableOrg()).rejects.toThrow(/view-only/i)
  })

  it("requireWritableOrg allows members", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "member" }])
    await expect(requireWritableOrg()).resolves.toMatchObject({ orgId: ORG_A })
  })

  it("requireManageOrg rejects plain members", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "member" }])
    await expect(requireManageOrg()).rejects.toThrow(/owners and admins/i)
  })

  it("requireManageOrg allows admins", async () => {
    installDb([{ orgId: ORG_A, name: "A", role: "admin" }])
    await expect(requireManageOrg()).resolves.toMatchObject({ orgId: ORG_A })
  })

  it("inviteOrgMember is denied for a member and writes nothing", async () => {
    const db = installDb([{ orgId: ORG_A, name: "A", role: "member" }])

    const result = await inviteOrgMember(
      null,
      formData({ email: "new@example.com", role: "admin" })
    )

    expect(result).toMatchObject({ ok: false })
    expect(db.callsFor("organization_invites")).toHaveLength(0)
  })
})

describe("Server Actions: cross-tenant writes are denied", () => {
  const expenseForm = (propertyId: string) =>
    formData({
      property_id: propertyId,
      expense_category: "Roof",
      incurred_date: "2026-10-01",
      amount: "1000",
    })

  it("logOperatingExpense: a viewer cannot write (and nothing is inserted)", async () => {
    const db = installDb([{ orgId: ORG_A, name: "A", role: "viewer" }])

    const result = await logOperatingExpense(null, expenseForm("prop_1"))

    expect(result).toMatchObject({ ok: false })
    expect(db.callsFor("operating_expenses", "insert")).toHaveLength(0)
  })

  it("logOperatingExpense: another org's property id is rejected, scoped by the active org", async () => {
    const db = installDb([{ orgId: ORG_A, name: "A", role: "member" }], (call) =>
      call.table === "properties" ? { data: null } : undefined
    )

    const result = await logOperatingExpense(null, expenseForm("prop_of_org_c"))

    expect(result).toEqual({
      ok: false,
      error: "That property is not in this workspace.",
    })
    const [lookup] = db.callsFor("properties", "select")
    expect(filterValue(lookup, "organization_id")).toBe(ORG_A)
    expect(db.callsFor("operating_expenses", "insert")).toHaveLength(0)
  })

  it("updateLeaseAccountingInputs: a lease whose property is in another org is rejected without updating", async () => {
    const db = installDb([{ orgId: ORG_A, name: "A", role: "member" }], (call) => {
      if (call.table === "leases" && call.op === "select") {
        return { data: { id: "lease_x", property_id: "prop_of_org_c" } }
      }
      if (call.table === "properties") return { data: null } // not in active org
      return undefined
    })

    const result = await updateLeaseAccountingInputs(
      null,
      formData({ lease_id: "lease_x", ibr_pct: "5" })
    )

    expect(result).toEqual({
      ok: false,
      error: "That lease is not in this workspace.",
    })
    expect(db.callsFor("leases", "update")).toHaveLength(0)
  })

  it("updateLeaseAccountingInputs: a viewer is denied", async () => {
    const db = installDb([{ orgId: ORG_A, name: "A", role: "viewer" }])

    const result = await updateLeaseAccountingInputs(
      null,
      formData({ lease_id: "lease_1", ibr_pct: "5" })
    )

    expect(result).toMatchObject({ ok: false })
    expect(db.callsFor("leases", "update")).toHaveLength(0)
  })
})
