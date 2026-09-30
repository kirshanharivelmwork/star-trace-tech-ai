"use client"

import { useState } from "react"
import type { KeyboardEvent } from "react"
import { useChat } from "@ai-sdk/react"
import { ArrowUp, Loader2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

const EMPTY_STATE_PROMPTS = [
  "Summarize this week's key metrics",
  "Draft a follow-up email for a churn-risk customer",
  "What should I prioritize today?",
] as const

export const ChatPanel = () => {
  const { messages, sendMessage, status, stop } = useChat()
  const [input, setInput] = useState("")

  const isBusy = status === "submitted" || status === "streaming"

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy) return

    sendMessage({ text: trimmed })
    setInput("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(input)
    }
  }

  return (
    <Card className="flex h-full min-h-[32rem] flex-col">
      <CardHeader>
        <CardTitle>AI Assistant</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden px-0">
        <ScrollArea className="h-full px-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>Ask anything about your dashboard.</p>
              <div className="flex flex-col gap-2">
                {EMPTY_STATE_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="sm"
                    onClick={() => submit(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl border border-violet-400/30 bg-violet-500/20 px-3 py-2 text-sm text-zinc-50 shadow-[0_0_18px_-8px_var(--glow-primary)]"
                      : "mr-auto max-w-[85%] rounded-2xl border border-zinc-800/80 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200"
                  }
                >
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <span key={`${message.id}-${index}`} className="whitespace-pre-wrap">
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
      </CardContent>

      <CardFooter className="flex-col gap-2 border-t bg-transparent pt-4">
        <form
          className="flex w-full items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit(input)
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the assistant…"
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
      </CardFooter>
    </Card>
  )
}
