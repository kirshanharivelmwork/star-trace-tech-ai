import { Suspense } from "react"
import Link from "next/link"
import { Sparkles } from "lucide-react"

import { LoginForm } from "@/components/auth/login-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,207,232,0.12),transparent_55%)]" />
      <div className="relative w-full max-w-md">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-heading text-lg font-semibold tracking-tight"
        >
          <span className="icon-well size-8">
            <Sparkles className="size-3.5" />
          </span>
          StarFlow
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-tight">
              Sign in to StarFlow
            </CardTitle>
            <p className="text-sm text-zinc-400">
              Two free lease abstracts. No credit card required.
            </p>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <div className="h-64 animate-pulse rounded-2xl bg-zinc-900/60" />
              }
            >
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
