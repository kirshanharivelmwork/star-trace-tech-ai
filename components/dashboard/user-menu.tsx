"use client"

import { useState, type FormEvent } from "react"
import { LogIn, LogOut, Mail } from "lucide-react"

import { useUser } from "@/components/providers/user-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { createClient } from "@/lib/supabase/client"

type SendStatus = "idle" | "sending" | "sent" | "error"

const getInitials = (email: string) => email.slice(0, 2).toUpperCase()

/**
 * Clean sign-in / sign-out control for the dashboard header, backed
 * entirely by Supabase Auth (passwordless magic link) — no Clerk or other
 * auth provider involved, per .cursor/rules/stack.mdc.
 */
export const UserMenu = () => {
  const { user, isLoading } = useUser()
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<SendStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const resetForm = () => {
    setStatus("idle")
    setErrorMessage(null)
    setEmail("")
  }

  const handleSendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return

    setStatus("sending")
    setErrorMessage(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus("error")
      setErrorMessage(error.message)
      return
    }

    setStatus("sent")
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    setIsSigningOut(false)
  }

  if (isLoading) {
    return <div className="h-8 w-20 animate-pulse rounded-lg bg-muted" />
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback>{getInitials(user.email ?? "?")}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline">
          {user.email}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleSignOut}
          disabled={isSigningOut}
        >
          <LogOut className="size-3.5" />
          <span className="sr-only">Sign out</span>
        </Button>
      </div>
    )
  }

  return (
    <Sheet onOpenChange={(open) => !open && resetForm()}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <LogIn className="size-3.5" />
        Sign in
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sign in</SheetTitle>
          <SheetDescription>
            We&apos;ll email you a magic link — no password needed.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSendMagicLink}
          className="flex flex-col gap-3 px-4"
        >
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={status === "sending" || status === "sent"}
            required
          />

          {status === "sent" ? (
            <p className="flex items-center gap-2 text-sm text-emerald-500">
              <Mail className="size-3.5" />
              Check your email for a sign-in link.
            </p>
          ) : status === "error" && errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}

          <Button
            type="submit"
            disabled={
              status === "sending" || status === "sent" || !email.trim()
            }
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </Button>
        </form>

        <SheetFooter />
      </SheetContent>
    </Sheet>
  )
}
