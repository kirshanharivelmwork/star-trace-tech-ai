import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createFakeSupabase,
  filterValue,
  type Call,
  type FakeSupabase,
  type QueryResult,
} from "../helpers/fake-supabase"

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getUserById: vi.fn(),
  admin: { current: null as unknown },
}))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.admin.current,
}))

import { GET } from "@/app/api/cron/alerts/route"

/** Midday UTC so day-count math is stable in any CI timezone. */
const TODAY = new Date("2026-10-05T12:00:00Z")
const DAY_MS = 86_400_000

const isoDateFromToday = (days: number) =>
  new Date(Date.UTC(2026, 9, 5 + days)).toISOString().slice(0, 10)

type AbstractRow = {
  id: string
  file_name: string
  user_id: string | null
  organization_id: string | null
  abstract_data: { tenantName: string; expirationDate: string }
}

const abstractExpiringIn = (
  id: string,
  days: number,
  overrides: Partial<AbstractRow> = {}
): AbstractRow => ({
  id,
  file_name: `${id}.pdf`,
  user_id: "user_1",
  organization_id: "org_1",
  abstract_data: {
    tenantName: `Tenant ${id}`,
    expirationDate: isoDateFromToday(days),
  },
  ...overrides,
})

type World = {
  abstracts: AbstractRow[]
  noticeWindows: Array<{
    id: string
    lease_id: string | null
    status: string | null
    target_date: string | null
  }>
  leases: Array<{ id: string; property_id: string; tenant_name: string }>
  properties: Array<{
    id: string
    user_id: string
    organization_id: string | null
    name: string
  }>
  members: Array<{ user_id: string; role: string }>
  /** Persisted across runs, like the real alert_dispatches table. */
  dispatches: Set<string>
}

const dispatchKey = (fields: {
  organization_id: unknown
  alert_type: unknown
  threshold_days: unknown
  lease_id: unknown
  abstract_id: unknown
}) =>
  [
    fields.organization_id,
    fields.alert_type,
    fields.threshold_days,
    fields.lease_id ?? null,
    fields.abstract_id ?? null,
  ].join("|")

const keyFromFilters = (call: Call) =>
  dispatchKey({
    organization_id: filterValue(call, "organization_id"),
    alert_type: filterValue(call, "alert_type"),
    threshold_days: filterValue(call, "threshold_days"),
    lease_id: filterValue(call, "lease_id"),
    abstract_id: filterValue(call, "abstract_id"),
  })

const emptyWorld = (): World => ({
  abstracts: [],
  noticeWindows: [],
  leases: [],
  properties: [],
  members: [{ user_id: "user_1", role: "owner" }],
  dispatches: new Set(),
})

const installWorld = (world: World): FakeSupabase => {
  const db = createFakeSupabase((call): QueryResult => {
    switch (call.table) {
      case "lease_abstracts":
        return { data: world.abstracts }
      case "notice_windows":
        return { data: world.noticeWindows }
      case "leases":
        return { data: world.leases }
      case "properties":
        return { data: world.properties }
      case "organization_members":
        return { data: world.members }
      case "alert_dispatches": {
        if (call.op === "upsert") {
          const row = call.payload as Parameters<typeof dispatchKey>[0]
          world.dispatches.add(dispatchKey(row)) // ON CONFLICT DO NOTHING
          return { data: null }
        }
        return { count: world.dispatches.has(keyFromFilters(call)) ? 1 : 0 }
      }
      default:
        return { data: null }
    }
  })
  // Only `auth.admin.getUserById` is used on the client besides query calls.
  Object.assign(db, { auth: { admin: { getUserById: mocks.getUserById } } })
  mocks.admin.current = db
  return db
}

const authorizedRequest = () =>
  new Request("http://localhost/api/cron/alerts", {
    headers: { authorization: "Bearer cron-secret" },
  })

const run = async () => {
  const response = await GET(authorizedRequest())
  return { response, body: (await response.json()) as Record<string, number> }
}

const sentTo = () =>
  mocks.send.mock.calls.map((call) => (call[0] as { to: string }).to)

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(TODAY)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("CRON_SECRET", "cron-secret")
  vi.stubEnv("RESEND_API_KEY", "re_test")
  mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null })
  mocks.getUserById.mockImplementation(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
    error: null,
  }))
  installWorld(emptyWorld())
})

afterEach(() => {
  vi.useRealTimers()
})

describe("cron alerts: authentication", () => {
  it("returns 401 for a wrong bearer token", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/alerts", {
        headers: { authorization: "Bearer nope" },
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const response = await GET(new Request("http://localhost/api/cron/alerts"))
    expect(response.status).toBe(401)
  })

  it("returns 500 when CRON_SECRET is not configured (never runs open)", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const response = await GET(authorizedRequest())
    expect(response.status).toBe(500)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("returns 500 when RESEND_API_KEY is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    const response = await GET(authorizedRequest())
    expect(response.status).toBe(500)
  })
})

describe("cron alerts: 90/60/30 day thresholds", () => {
  it("emails exactly at 90, 60 and 30 days and nothing else", async () => {
    const world = emptyWorld()
    world.abstracts = [
      abstractExpiringIn("d91", 91),
      abstractExpiringIn("d90", 90),
      abstractExpiringIn("d75", 75),
      abstractExpiringIn("d60", 60),
      abstractExpiringIn("d45", 45),
      abstractExpiringIn("d30", 30),
      abstractExpiringIn("d10", 10),
    ]
    const db = installWorld(world)

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.alertsSent).toBe(3)
    expect(body.alertsFailed).toBe(0)
    expect(mocks.send).toHaveBeenCalledTimes(3)

    const recorded = db
      .callsFor("alert_dispatches", "upsert")
      .map((call) => (call.payload as { threshold_days: number }).threshold_days)
      .sort((a, b) => a - b)
    expect(recorded).toEqual([30, 60, 90])
  })

  it("records dispatches idempotently: upsert with ignoreDuplicates on the unique key", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30)]
    const db = installWorld(world)

    await run()

    const [call] = db.callsFor("alert_dispatches", "upsert")
    expect(call.options).toEqual({
      onConflict: "organization_id,alert_type,threshold_days,lease_id,abstract_id",
      ignoreDuplicates: true,
    })
    expect(call.payload).toMatchObject({
      organization_id: "org_1",
      abstract_id: "d30",
      lease_id: null,
      alert_type: "expiration",
      threshold_days: 30,
    })
  })
})

describe("cron alerts: failed emails are not lost", () => {
  it("does NOT mark an alert dispatched when Resend returns an error, and counts it failed", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { message: "rate_limit_exceeded", name: "rate_limit_exceeded" },
    })
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30)]
    const db = installWorld(world)

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.alertsSent).toBe(0)
    expect(body.alertsFailed).toBe(1)
    expect(body.emailsFailed).toBe(1)
    expect(body.emailsSent).toBe(0)
    expect(db.callsFor("alert_dispatches", "upsert")).toHaveLength(0)
    expect(world.dispatches.size).toBe(0)
  })

  it("does NOT mark an alert dispatched when Resend throws", async () => {
    mocks.send.mockRejectedValue(new Error("network down"))
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30)]
    const db = installWorld(world)

    const { body } = await run()

    expect(body.alertsFailed).toBe(1)
    expect(db.callsFor("alert_dispatches", "upsert")).toHaveLength(0)
  })

  it("retries on the next run and then dispatches once the email succeeds", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30)]
    installWorld(world)

    mocks.send.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    const first = await run()
    expect(first.body.alertsFailed).toBe(1)
    expect(world.dispatches.size).toBe(0)

    const second = await run() // Resend recovered
    expect(second.body.alertsSent).toBe(1)
    expect(second.body.alertsFailed).toBe(0)
    expect(world.dispatches.size).toBe(1)
  })

  it("retries the NEXT day too (3-day grace) instead of losing a failed day-90 alert", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d90", 90)]
    installWorld(world)

    mocks.send.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    expect((await run()).body.alertsFailed).toBe(1)

    vi.setSystemTime(new Date(TODAY.getTime() + DAY_MS)) // now 89 days out
    const nextDay = await run()

    expect(nextDay.body.alertsSent).toBe(1)
    // Dedupe is keyed on the 90-day threshold, not the 89 actual days.
    expect(world.dispatches.size).toBe(1)
    expect([...world.dispatches][0]).toContain("|90|")
  })

  it("marks dispatched when at least one of several recipients was emailed", async () => {
    mocks.send.mockImplementation(async (message: { to: string }) =>
      message.to === "user_b@example.com"
        ? { data: null, error: { message: "mailbox full" } }
        : { data: { id: "ok" }, error: null }
    )
    const world = emptyWorld()
    world.members = [
      { user_id: "user_a", role: "owner" },
      { user_id: "user_b", role: "admin" },
      { user_id: "user_c", role: "viewer" }, // viewers are never emailed
    ]
    world.abstracts = [abstractExpiringIn("d30", 30)]
    const db = installWorld(world)

    const { body } = await run()

    expect(body.alertsSent).toBe(1)
    expect(body.alertsFailed).toBe(0)
    expect(body.emailsSent).toBe(1)
    expect(body.emailsFailed).toBe(1)
    expect(db.callsFor("alert_dispatches", "upsert")).toHaveLength(1)
    expect(sentTo().sort()).toEqual(["user_a@example.com", "user_b@example.com"])
  })

  it("counts an alert as failed (and sends nothing) when no recipient email can be resolved", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: null })
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30)]
    const db = installWorld(world)

    const { body } = await run()

    expect(mocks.send).not.toHaveBeenCalled()
    expect(body.alertsFailed).toBe(1)
    expect(db.callsFor("alert_dispatches", "upsert")).toHaveLength(0)
  })

  it("skips records with no organization_id (no dedupe possible) instead of emailing daily", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d30", 30, { organization_id: null })]
    installWorld(world)

    const { body } = await run()

    expect(mocks.send).not.toHaveBeenCalled()
    expect(body.alertsFailed).toBe(1)
  })
})

describe("cron alerts: running twice", () => {
  it("a repeat run the same day sends no duplicate email", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d90", 90), abstractExpiringIn("d30", 30)]
    installWorld(world)

    const first = await run()
    expect(first.body.alertsSent).toBe(2)
    expect(mocks.send).toHaveBeenCalledTimes(2)

    const second = await run()
    expect(second.body.alertsSent).toBe(0)
    expect(second.body.alertsSkipped).toBe(2)
    expect(mocks.send).toHaveBeenCalledTimes(2) // unchanged
  })

  it("does not re-send the day after a success (89 days is still inside the 90-day grace window)", async () => {
    const world = emptyWorld()
    world.abstracts = [abstractExpiringIn("d90", 90)]
    installWorld(world)

    await run()
    vi.setSystemTime(new Date(TODAY.getTime() + DAY_MS))
    const nextDay = await run()

    expect(nextDay.body.alertsSent).toBe(0)
    expect(nextDay.body.alertsSkipped).toBe(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})

describe("cron alerts: efficiency", () => {
  it("looks up each user's email once per run, however many alerts they have (no N+1)", async () => {
    const world = emptyWorld()
    world.abstracts = [
      abstractExpiringIn("a", 90),
      abstractExpiringIn("b", 60),
      abstractExpiringIn("c", 30),
    ]
    installWorld(world)

    await run()

    expect(mocks.getUserById).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(3)
  })
})

describe("cron alerts: notice windows", () => {
  it("emails a notice window 30 days out once, and not again on a repeat run", async () => {
    const world = emptyWorld()
    world.noticeWindows = [
      {
        id: "nw_1",
        lease_id: "lease_1",
        status: "open",
        target_date: isoDateFromToday(30),
      },
      {
        id: "nw_closed",
        lease_id: "lease_1",
        status: "closed",
        target_date: isoDateFromToday(30),
      },
    ]
    world.leases = [{ id: "lease_1", property_id: "prop_1", tenant_name: "Acme" }]
    world.properties = [
      { id: "prop_1", user_id: "user_1", organization_id: "org_1", name: "Tower" },
    ]
    installWorld(world)

    const first = await run()
    expect(first.body.noticeAlertsSent).toBe(1)
    expect(first.body.noticeAlertsFailed).toBe(0)
    expect(mocks.send).toHaveBeenCalledTimes(1)

    const second = await run()
    expect(second.body.noticeAlertsSent).toBe(0)
    expect(second.body.noticeAlertsSkipped).toBe(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it("does not mark a notice window dispatched when the email fails", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: "boom" } })
    const world = emptyWorld()
    world.noticeWindows = [
      {
        id: "nw_1",
        lease_id: "lease_1",
        status: "open",
        target_date: isoDateFromToday(60),
      },
    ]
    world.leases = [{ id: "lease_1", property_id: "prop_1", tenant_name: "Acme" }]
    world.properties = [
      { id: "prop_1", user_id: "user_1", organization_id: "org_1", name: "Tower" },
    ]
    const db = installWorld(world)

    const { body } = await run()

    expect(body.noticeAlertsFailed).toBe(1)
    expect(body.noticeAlertsSent).toBe(0)
    expect(db.callsFor("alert_dispatches", "upsert")).toHaveLength(0)
  })
})
