import Link from "next/link"
import {
  Bell,
  FileSearch,
  Landmark,
  Shield,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const primaryHref = user ? "/app" : "/login"
  const primaryLabel = user ? "Open dashboard" : "Start free"

  return (
    <main className="min-h-svh bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,207,232,0.14),transparent_50%)]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <span className="icon-well size-8">
            <Sparkles className="size-3.5" />
          </span>
          StarFlow
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <Button render={<Link href="/app" />} size="sm">
              Dashboard
            </Button>
          ) : (
            <>
              <Button render={<Link href="/login" />} variant="ghost" size="sm">
                Sign in
              </Button>
              <Button render={<Link href="/login" />} size="sm">
                Start free
              </Button>
            </>
          )}
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20 md:py-28">
        <p className="mb-4 text-xs tracking-[0.2em] text-pink-200/80 uppercase">
          Commercial lease intelligence
        </p>
        <h1 className="font-heading max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
          AI abstracts commercial leases, then runs the portfolio from the same record.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-400">
          StarFlow extracts lease terms from a PDF, then uses that record for
          portfolio risk, CAM allocations, notice windows, and a simplified
          lessee ASC 842 / IFRS 16 calculator.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button render={<Link href={primaryHref} />} size="lg" className="rounded-2xl">
            {primaryLabel}
          </Button>
          <p className="self-center text-sm text-zinc-500">
            2 abstracts free · then Pro
          </p>
        </div>
      </section>

      <section className="relative z-10 mx-auto grid max-w-6xl gap-4 px-6 pb-20 md:grid-cols-3">
        <Card>
          <CardHeader>
            <FileSearch className="size-5 text-pink-200" />
            <CardTitle className="pt-2">Lease abstractor</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-zinc-400">
            Upload a commercial lease PDF. Claude extracts parties, dates, rent,
            square footage, and notice deadlines into a structured abstract
            that becomes the live lease record.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Bell className="size-5 text-pink-200" />
            <CardTitle className="pt-2">Notice windows</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-zinc-400">
            90 / 60 / 30 day alerts for expirations and notice windows, in the
            product and by email to workspace owners and admins.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Landmark className="size-5 text-pink-200" />
            <CardTitle className="pt-2">CAM &amp; ASC 842</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-zinc-400">
            Prorate operating expenses by square footage and run a simplified
            monthly lessee schedule (ROU, liability, finance vs operating
            presentation). Not a replacement for an accountant.
          </CardContent>
        </Card>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Shield className="size-5 text-zinc-400" />
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-400">
            <p>
              Sessions use encrypted cookies over HTTPS. Postgres Row Level
              Security scopes lease data to the active workspace. User actions
              such as abstracts, expenses, invites, and billing portal opens
              are written to an append-only audit log.
            </p>
            <p className="text-xs text-zinc-500">
              StarFlow does not claim SOC 2 certification, and ASC 842 output
              is a calculator with disclosed assumptions — not audited GAAP or
              legal advice.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
