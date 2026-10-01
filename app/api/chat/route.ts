import { anthropic } from "@ai-sdk/anthropic"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { getOrgContext } from "@/lib/org/context"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 30

const MODEL_ID = "claude-sonnet-4-6"

const GENERAL_SYSTEM_PROMPT =
  "You are the AI assistant embedded in this dashboard. Keep answers concise, accurate, and well formatted."

const MAX_BODY_BYTES = 256 * 1024
const MAX_MESSAGES = 40

const buildLeaseSystemPrompt = (leaseContext: unknown) =>
  `You are an expert commercial real estate attorney. Answer the user's questions strictly using the provided lease context. If the answer is not in the context, state that clearly. Here is the lease data: ${JSON.stringify(leaseContext)}`

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

  const contentLength = Number(req.headers.get("content-length") ?? "0")
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large.", { status: 413 })
  }

  let body: {
    messages?: UIMessage[]
    leaseContext?: unknown
    leaseAbstractId?: string
  }

  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON body.", { status: 400 })
  }

  const messages = body.messages ?? []
  if (messages.length > MAX_MESSAGES) {
    return new Response("Too many messages in this request.", { status: 413 })
  }

  const org = await getOrgContext()
  if (!org) {
    return new Response("Workspace is not ready.", { status: 403 })
  }

  let leaseContext: unknown = undefined

  if (body.leaseAbstractId) {
    const { data, error } = await supabase
      .from("lease_abstracts")
      .select("id, organization_id, abstract_data")
      .eq("id", body.leaseAbstractId)
      .eq("organization_id", org.orgId)
      .maybeSingle()

    if (error || !data) {
      return new Response("You do not have access to that lease.", {
        status: 403,
      })
    }

    leaseContext = data.abstract_data
  } else if (body.leaseContext) {
    const serialized = JSON.stringify(body.leaseContext)
    if (serialized.length > 80_000) {
      return new Response("Lease context is too large.", { status: 413 })
    }
    leaseContext = body.leaseContext
  }

  const system = leaseContext
    ? buildLeaseSystemPrompt(leaseContext)
    : GENERAL_SYSTEM_PROMPT

  const result = streamText({
    model: anthropic(MODEL_ID),
    system,
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
