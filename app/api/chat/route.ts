import { anthropic } from "@ai-sdk/anthropic"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

// Route Handlers stream indefinitely, so allow the function to run long
// enough for the model to finish generating.
export const maxDuration = 30

// Requested model: Claude 3.5 Sonnet (pinned snapshot, per Anthropic's model
// docs). Kept as a single constant so it can be swapped for a newer Claude
// release (e.g. "claude-sonnet-5") in one place if this snapshot is retired.
const MODEL_ID = "claude-3-5-sonnet-20241022"

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: anthropic(MODEL_ID),
    system:
      "You are the AI assistant embedded in this dashboard. Keep answers concise, accurate, and well formatted.",
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
