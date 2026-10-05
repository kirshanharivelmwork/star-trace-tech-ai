import { anthropic } from "@ai-sdk/anthropic"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { LLM_MODEL_ID } from "@/lib/ai/model"
import { getOrgContext } from "@/lib/org/context"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 30

const GENERAL_SYSTEM_PROMPT =
  "You are the AI assistant embedded in this dashboard. Keep answers concise, accurate, and well formatted."

const MAX_BODY_BYTES = 256 * 1024
const MAX_MESSAGES = 40
const MAX_LEASE_CONTEXT_CHARS = 80_000
const MAX_ID_LENGTH = 64

const buildLeaseSystemPrompt = (leaseContext: unknown) =>
  `You are an expert commercial real estate attorney. Answer the user's questions strictly using the provided lease context. If the answer is not in the context, state that clearly. Here is the lease data: ${JSON.stringify(leaseContext)}`

type ChatBody = {
  messages?: unknown
  leaseContext?: unknown
  leaseAbstractId?: unknown
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return new Response("Unauthorized. Please sign in to use chat.", {
      status: 401,
    })
  }

  // The header can be missing (chunked) or wrong, so the real size is
  // enforced on the buffered body below as well.
  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (declaredLength > MAX_BODY_BYTES) {
    return new Response("Payload too large.", { status: 413 })
  }

  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response("Payload too large.", { status: 413 })
  }

  let body: ChatBody
  try {
    body = JSON.parse(rawBody) as ChatBody
  } catch {
    return new Response("Invalid JSON body.", { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return new Response("Invalid request body.", { status: 400 })
  }

  const messages = body.messages ?? []
  if (!Array.isArray(messages)) {
    return new Response("messages must be an array.", { status: 400 })
  }
  if (messages.length > MAX_MESSAGES) {
    return new Response("Too many messages in this request.", { status: 413 })
  }

  const org = await getOrgContext()
  if (!org) {
    return new Response("Workspace is not ready.", { status: 403 })
  }

  const rateLimit = await checkRateLimit(supabase, "chat", org.orgId)
  if (rateLimit !== "ok") return rateLimitResponse(rateLimit, "chat")

  let leaseContext: unknown = undefined

  if (body.leaseAbstractId !== undefined && body.leaseAbstractId !== null) {
    const abstractId = body.leaseAbstractId
    if (
      typeof abstractId !== "string" ||
      abstractId.length === 0 ||
      abstractId.length > MAX_ID_LENGTH
    ) {
      return new Response("Invalid leaseAbstractId.", { status: 400 })
    }

    // Loaded server-side through the caller's RLS-bound client AND pinned to
    // the active org, so a guessed/foreign id yields no row (-> 403) rather
    // than another tenant's lease. The client never supplies the content.
    const { data, error } = await supabase
      .from("lease_abstracts")
      .select("id, organization_id, abstract_data")
      .eq("id", abstractId)
      .eq("organization_id", org.orgId)
      .maybeSingle()

    if (error || !data) {
      return new Response("You do not have access to that lease.", {
        status: 403,
      })
    }

    leaseContext = data.abstract_data
  } else if (body.leaseContext) {
    // Only used for a lease that hasn't been saved yet (no id to load).
    // This is the caller's own text going into their own prompt — it can't
    // expose another tenant's data — but it is capped in size.
    const serialized = JSON.stringify(body.leaseContext)
    if (serialized.length > MAX_LEASE_CONTEXT_CHARS) {
      return new Response("Lease context is too large.", { status: 413 })
    }
    leaseContext = body.leaseContext
  }

  const system = leaseContext
    ? buildLeaseSystemPrompt(leaseContext)
    : GENERAL_SYSTEM_PROMPT

  const result = streamText({
    model: anthropic(LLM_MODEL_ID),
    system,
    messages: await convertToModelMessages(messages as UIMessage[]),
    abortSignal: req.signal,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
