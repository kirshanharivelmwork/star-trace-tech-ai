"use client"

import { useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"

type AuthMode = "signin" | "signup"
type AuthStatus = "idle" | "submitting" | "confirm-email" | "error"

const AUTH_FIELD_CLASS =
  "h-11 rounded-2xl border-zinc-800/80 bg-zinc-900/60 px-3.5 text-zinc-50 shadow-2xl backdrop-blur-xl placeholder:text-zinc-500"

/**
 * Email/password + Google/Microsoft OAuth.
 *
 * Supabase dashboard (Authentication → Providers) — enable these before
 * the buttons will succeed; the code is real, not a stub:
 *  1. Google: create OAuth credentials, paste Client ID/Secret, set
 *     redirect URL to https://<project>.supabase.co/auth/v1/callback
 *  2. Azure (Microsoft): same, provider id is `azure`
 *  3. Site URL / Redirect URLs must include http://localhost:3000/auth/callback
 *     and the production origin + /auth/callback
 */
export const LoginForm = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next") || "/app"

  const [mode, setMode] = useState<AuthMode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<AuthStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [oauthBusy, setOauthBusy] = useState<"google" | "azure" | null>(null)

  const isBusy = status === "submitting" || oauthBusy != null

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setStatus("idle")
    setErrorMessage(null)
    setPassword("")
  }

  const redirectAfterAuth = () => {
    router.push(nextPath.startsWith("/") ? nextPath : "/app")
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

      redirectAfterAuth()
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(nextPath)}`,
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

    redirectAfterAuth()
  }

  const handleOAuth = async (provider: "google" | "azure") => {
    setOauthBusy(provider)
    setErrorMessage(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(nextPath)}`,
      },
    })
    if (error) {
      setOauthBusy(null)
      setStatus("error")
      setErrorMessage(error.message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              ? "bg-pink-200 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
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
              ? "bg-pink-200 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
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
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
        {status === "submitting"
          ? mode === "signin"
            ? "Signing in…"
            : "Creating account…"
          : mode === "signin"
            ? "Sign In"
            : "Start free"}
      </Button>

      <div className="relative py-1 text-center text-[11px] tracking-widest text-zinc-500 uppercase">
        <span className="bg-zinc-950 px-2">or continue with</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-2xl"
          disabled={isBusy}
          onClick={() => handleOAuth("google")}
        >
          {oauthBusy === "google" ? "Redirecting…" : "Google"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-2xl"
          disabled={isBusy}
          onClick={() => handleOAuth("azure")}
        >
          {oauthBusy === "azure" ? "Redirecting…" : "Microsoft"}
        </Button>
      </div>
    </form>
  )
}
