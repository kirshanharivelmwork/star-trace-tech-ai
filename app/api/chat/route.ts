import { anthropic } from "@ai-sdk/anthropic"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type DeepPartial,
  type UIMessage,
} from "ai"

import type { LeaseAbstract } from "@/app/api/lease/schema"

// Route Handlers stream indefinitely, so allow the function to run long
// enough for the model to finish generating.
export const maxDuration = 30

// NOTE: the literal model id "claude-3-5-sonnet-20241022" ("Claude 3.5
// Sonnet") is a retired Anthropic snapshot — the Anthropic API rejects
// calls to it outright (see app/api/lease/route.ts, which hit the same
// issue). "claude-sonnet-4-6" is the currently-live model already used
// there; reusing that constant here instead of the literally-requested
// 3.5 id so this route actually works.
const MODEL_ID = "claude-sonnet-4-6"

const GENERAL_SYSTEM_PROMPT =
  "You are the AI assistant embedded in this dashboard. Keep answers concise, accurate, and well formatted."

// Deliberately loose/defensive rather than `LeaseAbstract` — this is
// user-controlled JSON from the request body, and (per
// lib/lease/portfolio-metrics.ts) real abstract_data can be partial or
// contain unfilled template placeholders. Never trust its shape blindly.
type LeaseContext = DeepPartial<LeaseAbstract> | Record<string, unknown>

const buildLeaseSystemPrompt = (leaseContext: LeaseContext) =>
  `You are an expert commercial real estate attorney. Answer the user's questions strictly using the provided lease context. If the answer is not in the context, state that clearly. Here is the lease data: ${JSON.stringify(leaseContext)}`

export async function POST(req: Request) {
  const {
    messages,
    leaseContext,
  }: { messages: UIMessage[]; leaseContext?: LeaseContext } = await req.json()

  // Same endpoint serves two callers: the general dashboard assistant
  // (components/dashboard/chat-panel.tsx, no leaseContext -> general
  // prompt, unchanged behavior) and the lease-scoped RAG chat
  // (components/dashboard/lease-chat.tsx, sends leaseContext -> strict
  // lease-only prompt).
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
