import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createFakeSupabase,
  type Call,
  type FakeSupabase,
  type QueryResult,
} from "../helpers/fake-supabase"

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieve: vi.fn(),
  admin: { current: null as unknown },
}))

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.retrieve },
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.admin.current,
}))

import { POST } from "@/app/api/stripe/webhook/route"

const PERIOD_END_SECONDS = 1_800_000_000

const makeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_123",
  status: "active",
  customer: "cus_123",
  metadata: { orgId: "org_1", userId: "user_1" },
  items: {
    data: [
      { price: { id: "price_pro" }, current_period_end: PERIOD_END_SECONDS },
    ],
  },
  ...overrides,
})

const checkoutEvent = (overrides: Record<string, unknown> = {}) => ({
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      mode: "subscription",
      subscription: "sub_123",
      customer: "cus_123",
      client_reference_id: "user_1",
      metadata: { orgId: "org_1", userId: "user_1" },
      ...overrides,
    },
  },
})

const subscriptionEvent = (
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  subscription = makeSubscription()
) => ({ type, data: { object: subscription } })

const request = (headers: Record<string, string> = { "stripe-signature": "sig" }) =>
  new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers,
    body: "{}",
  })

/** Default DB: no pre-existing subscription row, every write succeeds. */
const installDb = (
  override?: (call: Call) => QueryResult | undefined
): FakeSupabase => {
  const db = createFakeSupabase((call) => override?.(call) ?? { data: null })
  mocks.admin.current = db
  return db
}

const upsertPayload = (db: FakeSupabase) =>
  db.callsFor("subscriptions", "upsert")[0]?.payload as Record<string, unknown>

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test")
  mocks.retrieve.mockResolvedValue(makeSubscription())
  installDb()
})

describe("stripe webhook: request validation", () => {
  it("returns 500 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "")
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(mocks.constructEvent).not.toHaveBeenCalled()
  })

  it("returns 400 when the stripe-signature header is missing", async () => {
    const response = await POST(request({}))
    expect(response.status).toBe(400)
  })

  it("returns 400 when the signature is invalid", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature")
    })
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})

describe("stripe webhook: event handling writes the right row", () => {
  it("checkout.session.completed upserts the org's subscription from live Stripe state", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent())
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_123")

    const [call] = db.callsFor("subscriptions", "upsert")
    expect(call.options).toEqual({ onConflict: "organization_id" })
    expect(upsertPayload(db)).toMatchObject({
      organization_id: "org_1",
      user_id: "user_1",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      status: "active",
      price_id: "price_pro",
      current_period_end: new Date(PERIOD_END_SECONDS * 1000).toISOString(),
    })
  })

  it("attributes via client_reference_id / session metadata, not just subscription metadata", async () => {
    mocks.retrieve.mockResolvedValue(makeSubscription({ metadata: {} }))
    mocks.constructEvent.mockReturnValue(checkoutEvent())
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(upsertPayload(db)).toMatchObject({
      organization_id: "org_1",
      user_id: "user_1",
    })
  })

  it("customer.subscription.updated stores the current status (e.g. past_due after a failed payment)", async () => {
    mocks.retrieve.mockResolvedValue(makeSubscription({ status: "past_due" }))
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent("customer.subscription.updated", makeSubscription())
    )
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(upsertPayload(db)).toMatchObject({
      organization_id: "org_1",
      status: "past_due",
      stripe_subscription_id: "sub_123",
    })
  })

  it("customer.subscription.deleted marks the row canceled without re-reading Stripe", async () => {
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent("customer.subscription.deleted")
    )
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.retrieve).not.toHaveBeenCalled()
    expect(upsertPayload(db)).toMatchObject({
      organization_id: "org_1",
      status: "canceled",
    })
  })

  it("ignores unrelated event types with a 200 and no DB access", async () => {
    mocks.constructEvent.mockReturnValue({ type: "invoice.created", data: {} })
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(db.calls).toHaveLength(0)
  })
})

describe("stripe webhook: ordering and idempotency", () => {
  it("subscription.updated arriving BEFORE checkout.session.completed still creates the row", async () => {
    // No existing row (default DB) — metadata on the subscription carries the org.
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent("customer.subscription.updated")
    )
    const db = installDb()

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(db.callsFor("subscriptions", "upsert")).toHaveLength(1)
    expect(upsertPayload(db)).toMatchObject({
      organization_id: "org_1",
      user_id: "user_1",
      status: "active",
    })
  })

  it("replaying the same event is idempotent: identical upsert target and payload", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent())
    const db = installDb()

    expect((await POST(request())).status).toBe(200)
    expect((await POST(request())).status).toBe(200)

    const upserts = db.callsFor("subscriptions", "upsert")
    expect(upserts).toHaveLength(2)
    const strip = (payload: unknown) => {
      const { updated_at: _ignored, ...rest } = payload as Record<string, unknown>
      void _ignored
      return rest
    }
    expect(strip(upserts[0].payload)).toEqual(strip(upserts[1].payload))
    expect(upserts[0].options).toEqual(upserts[1].options)
  })

  it("a stale terminal event for a superseded subscription does not cancel the newer one", async () => {
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent(
        "customer.subscription.deleted",
        makeSubscription({ id: "sub_OLD" })
      )
    )
    const db = installDb((call) =>
      call.table === "subscriptions" && call.op === "select"
        ? { data: { stripe_subscription_id: "sub_NEW" } }
        : undefined
    )

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(db.callsFor("subscriptions", "upsert")).toHaveLength(0)
  })

  it("an event that cannot be attributed to any org returns 200 (retrying cannot help) without writing", async () => {
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent(
        "customer.subscription.deleted",
        makeSubscription({ metadata: {} })
      )
    )
    const db = installDb() // lookup by stripe_subscription_id finds nothing

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(db.callsFor("subscriptions", "upsert")).toHaveLength(0)
  })
})

describe("stripe webhook: failures return 500 so Stripe retries", () => {
  const events = [
    ["checkout.session.completed", () => checkoutEvent()],
    [
      "customer.subscription.updated",
      () => subscriptionEvent("customer.subscription.updated"),
    ],
    [
      "customer.subscription.deleted",
      () => subscriptionEvent("customer.subscription.deleted"),
    ],
  ] as const

  it.each(events)("%s: a DB upsert error returns 500", async (_name, build) => {
    mocks.constructEvent.mockReturnValue(build())
    installDb((call) =>
      call.op === "upsert"
        ? { error: { message: "connection reset" } }
        : undefined
    )

    const response = await POST(request())

    expect(response.status).toBe(500)
  })

  it("a DB error while looking up an existing row returns 500", async () => {
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent("customer.subscription.deleted")
    )
    installDb((call) =>
      call.op === "select" ? { error: { message: "timeout" } } : undefined
    )

    expect((await POST(request())).status).toBe(500)
  })

  it("a Stripe API failure while reading the subscription returns 500", async () => {
    mocks.retrieve.mockRejectedValue(new Error("Stripe is down"))
    mocks.constructEvent.mockReturnValue(checkoutEvent())

    expect((await POST(request())).status).toBe(500)
  })

  it("never logs the webhook secret", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent())
    installDb((call) =>
      call.op === "upsert" ? { error: { message: "boom" } } : undefined
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await POST(request())

    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain("whsec_test")
  })
})
