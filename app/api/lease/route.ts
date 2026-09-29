import { anthropic } from "@ai-sdk/anthropic"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

// Dedicated endpoint for the Commercial Lease Abstractor (see
// components/dashboard/lease-uploader.tsx). Kept separate from
// app/api/chat/route.ts so the general-purpose dashboard assistant keeps
// its own persona and isn't affected by changes here.

// PDF lease analysis can take longer than a simple chat reply, so allow
// extra time for the model to finish.
export const maxDuration = 60

// Requested model: Claude 3.5 Sonnet (pinned snapshot, per Anthropic's model
// docs). Kept as a single constant so it can be swapped for a newer Claude
// release (e.g. "claude-sonnet-5") in one place if this snapshot is retired.
// Claude 3.5 Sonnet supports reading PDF documents natively — no separate
// parsing step is needed; `file` parts are sent straight through to the
// Anthropic API by `convertToModelMessages`.
const MODEL_ID = "claude-3-5-sonnet-20241022"

const SYSTEM_PROMPT = `You are an expert commercial real estate attorney acting as a Commercial Lease Abstractor.

Carefully read the entire attached PDF lease document and produce a structured abstract covering:

1. **Base rent** — amount(s), payment schedule/frequency, and any scheduled escalations.
2. **Common Area Maintenance (CAM) charges** — how they're calculated (pro rata share, fixed, etc.), what's included/excluded, and caps if any.
3. **Renewal and termination options** — number of options, notice requirements, and any conditions (e.g. rent adjustments on renewal).
4. **Critical dates** — commencement date, expiration date, and all notice windows (renewal notice deadline, termination notice deadline, etc.).

Present the abstract with clear headings for each of the four categories above. If a category isn't addressed in the document, say so explicitly rather than guessing. Quote or cite the relevant clause/section when possible. This is not legal advice — note that at the end of the abstract.`

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
