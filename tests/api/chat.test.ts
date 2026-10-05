import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createFakeSupabase,
  filterValue,
  type Call,
  type FakeSupabase,
  type QueryResult,
} from "../helpers/fake-supabase"
import type { OrgContext } from "@/lib/org/types"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getOrgContext: vi.fn(),
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(),
  client: { current: null as unknown },
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mocks.client.current,
}))
vi.mock("@/lib/org/context", () => ({ getOrgContext: mocks.getOrgContext }))
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ model }),
}))
vi.mock("ai", () => ({
  streamText: mocks.streamText,
  convertToModelMessages: mocks.convertToModelMessages,
  toUIMessageStream: () => "ui-stream",
  createUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
}))

import { POST } from "@/app/api/chat/route"

const ORG_ID = "11111111-1111-4111-8111-111111111111"

const org: OrgContext = {
  userId: "user_1",
  email: "u@example.com",
  orgId: ORG_ID,
  orgName: "Acme",
  role: "viewer",
  memberships: [{ orgId: ORG_ID, orgName: "Acme", role: "viewer" }],
  canWrite: false,
  canManageOrg: false,
}

const userMessage = (text = "hi") => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )

const installDb = (
  rateLimit: QueryResult = { data: true },
  tables?: (call: Call) => QueryResult | undefined
): FakeSupabase => {
  const db = createFakeSupabase((call): QueryResult => {
    if (call.op === "rpc") return rateLimit
    return tables?.(call) ?? { data: null }
  })
  Object.assign(db, { auth: { getUser: mocks.getUser } })
  mocks.client.current = db
  return db
}

const systemPromptSent = () =>
  (mocks.streamText.mock.calls[0][0] as { system: string }).system

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user_1" } },
    error: null,
  })
  mocks.getOrgContext.mockResolvedValue(org)
  mocks.convertToModelMessages.mockResolvedValue([])
  mocks.streamText.mockReturnValue({ stream: "llm-stream" })
  installDb()
})

describe("POST /api/chat: authentication", () => {
  it("returns 401 when unauthenticated, without touching the LLM", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const response = await post({ messages: [userMessage()] })

    expect(response.status).toBe(401)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("returns 401 when the auth lookup errors", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "jwt expired" },
    })
    expect((await post({ messages: [] })).status).toBe(401)
  })

  it("returns 403 when the user has no workspace", async () => {
    mocks.getOrgContext.mockResolvedValue(null)
    expect((await post({ messages: [userMessage()] })).status).toBe(403)
  })
})

describe("POST /api/chat: payload caps", () => {
  it("returns 413 when the declared content-length exceeds the cap", async () => {
    const response = await post(
      { messages: [userMessage()] },
      { "content-length": String(10 * 1024 * 1024) }
    )
    expect(response.status).toBe(413)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("returns 413 for an oversized body even with NO content-length header", async () => {
    const huge = JSON.stringify({ messages: [userMessage("x".repeat(300 * 1024))] })
    const response = await post(huge) // header-based check alone would miss this
    expect(response.status).toBe(413)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("returns 413 when there are more than 40 messages", async () => {
    const messages = Array.from({ length: 41 }, () => userMessage("hi"))
    const response = await post({ messages })
    expect(response.status).toBe(413)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("accepts exactly 40 messages", async () => {
    const messages = Array.from({ length: 40 }, () => userMessage("hi"))
    expect((await post({ messages })).status).toBe(200)
  })

  it("returns 413 when client-supplied leaseContext is too large", async () => {
    const response = await post({
      messages: [userMessage()],
      leaseContext: { notes: "x".repeat(90_000) },
    })
    expect(response.status).toBe(413)
  })

  it("returns 400 when messages is not an array", async () => {
    expect((await post({ messages: "hello" })).status).toBe(400)
  })

  it("returns 400 for invalid JSON", async () => {
    expect((await post("{nope")).status).toBe(400)
  })
})

describe("POST /api/chat: rate limiting", () => {
  it("returns 429 when the per-user or per-org cap is exceeded", async () => {
    installDb({ data: false })

    const response = await post({ messages: [userMessage()] })

    expect(response.status).toBe(429)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("fails closed with 503 if the limiter errors", async () => {
    installDb({ error: { message: "rpc missing" } })
    expect((await post({ messages: [userMessage()] })).status).toBe(503)
  })

  it("rate limits per active organization", async () => {
    const db = installDb()
    await post({ messages: [userMessage()] })
    const [call] = db.callsFor("consume_rate_limit", "rpc")
    expect(call.payload).toMatchObject({ p_scope: "chat", p_org_id: ORG_ID })
  })
})

describe("POST /api/chat: lease context tenancy", () => {
  it("loads the abstract server-side, pinned to the caller's org", async () => {
    const db = installDb({ data: true }, (call) =>
      call.table === "lease_abstracts"
        ? { data: { id: "abs_1", abstract_data: { tenantName: "RealCo" } } }
        : undefined
    )

    const response = await post({
      messages: [userMessage()],
      leaseAbstractId: "abs_1",
    })

    expect(response.status).toBe(200)
    const [query] = db.callsFor("lease_abstracts", "select")
    expect(filterValue(query, "id")).toBe("abs_1")
    expect(filterValue(query, "organization_id")).toBe(ORG_ID)
    expect(systemPromptSent()).toContain("RealCo")
  })

  it("returns 403 for another organization's abstract id (query returns no row)", async () => {
    installDb({ data: true }, (call) =>
      call.table === "lease_abstracts" ? { data: null } : undefined
    )

    const response = await post({
      messages: [userMessage()],
      leaseAbstractId: "abs_of_another_org",
    })

    expect(response.status).toBe(403)
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("ignores a crafted leaseContext when a leaseAbstractId is provided", async () => {
    installDb({ data: true }, (call) =>
      call.table === "lease_abstracts"
        ? { data: { id: "abs_1", abstract_data: { tenantName: "RealCo" } } }
        : undefined
    )

    await post({
      messages: [userMessage()],
      leaseAbstractId: "abs_1",
      leaseContext: { tenantName: "FORGED-TENANT" },
    })

    expect(systemPromptSent()).toContain("RealCo")
    expect(systemPromptSent()).not.toContain("FORGED-TENANT")
  })

  it("rejects a non-string or oversized leaseAbstractId with 400 (no query)", async () => {
    const db = installDb()
    expect(
      (await post({ messages: [], leaseAbstractId: { $ne: null } })).status
    ).toBe(400)
    expect(
      (await post({ messages: [], leaseAbstractId: "x".repeat(500) })).status
    ).toBe(400)
    expect(db.callsFor("lease_abstracts")).toHaveLength(0)
  })

  it("never queries other tables: crafted context cannot widen what is read", async () => {
    const db = installDb()
    await post({
      messages: [userMessage()],
      leaseContext: { anything: "goes" },
    })
    expect(db.callsFor("lease_abstracts")).toHaveLength(0)
    expect(systemPromptSent()).toContain("goes") // caller's own text, own prompt
  })
})
