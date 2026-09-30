"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, LogIn, LogOut } from "lucide-react"
import { cn } from "cn"

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

type AuthMode = "signin" | "signup"
type AuthStatus = "idle" | "submitting" | "confirm-email" | "error"

const AUTH_FIELD_CLASS =
  "h-11 rounded-2xl border-zinc-800/80 bg-zinc-900/60 px-3.5 text-zinc-50 shadow-2xl backdrop-blur-xl placeholder:text-zinc-500"

const getInitials = (email: string) => email.slice(0, 2).toUpperCase()

/**
 * Sign-in / sign-up / sign-out control for the dashboard header, backed
 * entirely by Supabase Auth (email + password) — no Clerk or other
 * auth provider involved, per .cursor/rules/stack.mdc.
 */
export const UserMenu = () => {
  const router = useRouter()
  const { user, isLoading } = useUser()
  const [mode, setMode] = useState<AuthMode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<AuthStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const isBusy = status === "submitting"

  const resetForm = () => {
    setStatus("idle")
    setErrorMessage(null)
    setEmail("")
    setPassword("")
    setShowPassword(false)
    setMode("signin")
  }

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setStatus("idle")
    setErrorMessage(null)
    setPassword("")
  }

  const redirectToDashboard = () => {
    setSheetOpen(false)
    resetForm()
    router.push("/")
    router.refresh()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) return

    setStatus("submitting")
    setErrorMessage(null)

    const supabase = createClient()

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (error) {
        setStatus("error")
        setErrorMessage(error.message)
        return
      }

      redirectToDashboard()
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus("error")
      setErrorMessage(error.message)
      return
    }

    if (!data.session) {
      setStatus("confirm-email")
      return
    }

    redirectToDashboard()
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    setIsSigningOut(false)
    router.refresh()
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
    <Sheet
      open={sheetOpen}
      onOpenChange={(open) => {
        setSheetOpen(open)
        if (!open) resetForm()
      }}
    >
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <LogIn className="size-3.5" />
        Sign in
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </SheetTitle>
          <SheetDescription className="text-zinc-400">
            {mode === "signin"
              ? "Sign in with your email and password to access your portfolio."
              : "Create an account to start abstracting leases and tracking risk."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4">
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 gap-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              onClick={() => switchMode("signin")}
              disabled={isBusy}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium tracking-wide transition-all",
                mode === "signin"
                  ? "bg-zinc-100 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
                  : "text-zinc-400 hover:text-zinc-100"
              )}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              onClick={() => switchMode("signup")}
              disabled={isBusy}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium tracking-wide transition-all",
                mode === "signup"
                  ? "bg-zinc-100 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
                  : "text-zinc-400 hover:text-zinc-100"
              )}
            >
              Sign Up
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="auth-email"
              className="text-xs font-medium tracking-wide text-zinc-400"
            >
              Email
            </label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isBusy || status === "confirm-email"}
              required
              className={AUTH_FIELD_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="auth-password"
              className="text-xs font-medium tracking-wide text-zinc-400"
            >
              Password
            </label>
            <div className="relative">
              <Input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "signup" ? "At least 6 characters" : "••••••••"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isBusy || status === "confirm-email"}
                required
                minLength={6}
                className={`${AUTH_FIELD_CLASS} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={isBusy || status === "confirm-email"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          {status === "confirm-email" ? (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Check your email to confirm your account, then sign in.
            </p>
          ) : null}

          {status === "error" && errorMessage ? (
            <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={
              isBusy ||
              status === "confirm-email" ||
              !email.trim() ||
              password.length < 6
            }
            className="h-11 rounded-2xl"
          >
            {isBusy
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign In"
                : "Sign Up"}
          </Button>
        </form>

        <SheetFooter />
      </SheetContent>
    </Sheet>
  )
}
