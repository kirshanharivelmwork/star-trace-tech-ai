import { AlertCircle, Building2, Clock, FileWarning } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import {
  calculatePortfolioMetrics,
  type PortfolioLeaseRow,
} from "@/lib/lease/portfolio-metrics"

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

const daysUntil = (date: Date) => {
  const now = new Date()
  return Math.max(
    0,
    Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  )
}

type MetricCard = {
  label: string
  value: string
  change: string
  icon: LucideIcon
}

/**
 * Server Component: fetches the current user's lease_abstracts rows via
 * the @supabase/ssr server client and renders real portfolio metrics
 * computed from their parsed abstract_data — replaces the static/fake
 * stat cards that used to live directly in app/page.tsx.
 */
export const PortfolioAnalytics = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <Building2 className="size-5" />
          <p>Sign in to see your portfolio analytics.</p>
        </CardContent>
      </Card>
    )
  }

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("id, file_name, abstract_data")
    .eq("user_id", user.id)

  if (error) {
    console.error(
      "[PortfolioAnalytics] Failed to fetch lease_abstracts:",
      error.message
    )
  }

  const records = (data ?? []) as PortfolioLeaseRow[]
  const metrics = calculatePortfolioMetrics(records)

  const cards: MetricCard[] = [
    {
      label: "Total Leases",
      value: String(metrics.totalLeases),
      change:
        metrics.totalLeases === 0
          ? "No leases analyzed yet"
          : "Across your portfolio",
      icon: Building2,
    },
    {
      label: "Upcoming Expirations",
      value: String(metrics.upcomingExpirations),
      change: "Within the next 24 months",
      icon: AlertCircle,
    },
    {
      label: "Portfolio WALT",
      value:
        metrics.waltYears != null ? `${metrics.waltYears.toFixed(1)} yrs` : "N/A",
      change:
        metrics.waltYears != null
          ? "Weighted average lease term"
          : "No parseable lease terms yet",
      icon: Clock,
    },
    {
      label: "Needs Review",
      value: String(metrics.needsReviewCount),
      change: "Missing or placeholder term/dates",
      icon: FileWarning,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
                {card.label}
              </CardTitle>
              <card.icon className="size-4 text-violet-300" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-zinc-50">
                {card.value}
              </div>
              <p className="mt-1 text-xs text-zinc-500">{card.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Critical Upcoming Dates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.criticalDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming expirations with a parseable date yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                    <th className="px-4 py-3 font-medium">Lease</th>
                    <th className="px-4 py-3 font-medium">Expiration</th>
                    <th className="px-4 py-3 font-medium">Days left</th>
                    <th className="px-4 py-3 font-medium">Rent review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {metrics.criticalDates.map((entry) => (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-violet-500/5"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium tracking-tight text-zinc-50">
                          {entry.tenantName ?? entry.fileName}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {entry.fileName}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {formatDate(entry.expirationDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {daysUntil(entry.expirationDate)}
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-3 text-zinc-500">
                        {entry.rentReviewDetails ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
