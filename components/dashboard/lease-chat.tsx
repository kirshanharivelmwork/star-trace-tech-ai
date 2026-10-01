"use client"

import { useState } from "react"
import type { KeyboardEvent } from "react"
import { useChat } from "@ai-sdk/react"
import type { DeepPartial } from "ai"
import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { LeaseAbstract } from "@/app/api/lease/schema"

type LeaseChatProps = {
  /** Current lease's extracted data, sent as `leaseContext` on every request. */
  abstractData: DeepPartial<LeaseAbstract> | undefined
  fileName?: string | null
}

const EMPTY_STATE_PROMPTS = [
  "What is the termination notice period?",
  "Summarize the rent review terms",
  "Are there any tenant use restrictions?",
] as const

/**
 * Lease-scoped RAG chat window. Shares app/api/chat/route.ts with the
 * general dashboard assistant (components/dashboard/chat-panel.tsx), but
 * attaches the current lease's abstract_data as `leaseContext` on every
 * message — the server detects that field and swaps in a strict,
 * lease-only system prompt instead of the general one.
 */
export const LeaseChat = ({ abstractData, fileName }: LeaseChatProps) => {
  const { messages, sendMessage, status, stop } = useChat()
  const [input, setInput] = useState("")

  const isBusy = status === "submitted" || status === "streaming"
  const hasContext = Boolean(
    abstractData && Object.keys(abstractData).length > 0
  )

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy) return

    // Per-call `body` is merged into the request on top of any
    // transport-level body, so this always reflects the latest
    // `abstractData` prop rather than whatever was current on mount.
    sendMessage({ text: trimmed }, { body: { leaseContext: abstractData } })
    setInput("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(input)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            Ask AI about this lease
          </span>
          {fileName ? (
            <span className="truncate text-xs text-muted-foreground">
              {fileName}
            </span>
          ) : null}
        </div>
      </div>

      {!hasContext ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
          Lease data is still loading — answers may be incomplete until
          extraction finishes.
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 px-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <p>Ask anything about this lease.</p>
            <div className="flex flex-col gap-2">
              {EMPTY_STATE_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  onClick={() => submit(prompt)}
                  disabled={isBusy}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl border border-pink-300/30 bg-pink-400/20 px-3 py-2 text-sm text-zinc-50 shadow-[0_0_18px_-8px_var(--glow-primary)]"
                    : "mr-auto max-w-[85%] rounded-2xl border border-zinc-800/80 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200"
                }
              >
                {message.parts.map((part, index) =>
                  part.type === "text" ? (
                    <span
                      key={`${message.id}-${index}`}
                      className="whitespace-pre-wrap"
                    >
                      {part.text}
                    </span>
                  ) : null
                )}
              </div>
            ))}
            {status === "submitted" ? (
              <div className="mr-auto flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Thinking…
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      <form
        className="flex items-end gap-2 border-t border-zinc-800/80 bg-zinc-950/40 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit(input)
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this lease…"
          disabled={isBusy}
          className="min-h-10 flex-1 resize-none"
        />
        {isBusy ? (
          <Button type="button" variant="outline" size="icon" onClick={stop}>
            <Square className="size-4" />
            <span className="sr-only">Stop generating</span>
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!input.trim()}>
            <ArrowUp className="size-4" />
            <span className="sr-only">Send message</span>
          </Button>
        )}
      </form>
    </div>
  )
}
