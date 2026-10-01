import { AlertCircle, Building2, Clock, FileWarning } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { MetricTile } from "@/components/dashboard/metric-tile"
import { SpatialCardStack } from "@/components/dashboard/spatial-card-stack"
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
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SpatialCardStack
          cards={[
            {
              eyebrow: "StarFlow · Portfolio",
              title: "Active leases",
              value: "—",
              tone: "pink",
            },
            {
              eyebrow: "Weighted term",
              title: "Portfolio WALT",
              value: "—",
              tone: "mint",
            },
            {
              eyebrow: "Watchlist",
              title: "Needs review",
              value: "—",
              tone: "blue",
            },
          ]}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <span className="icon-well size-10">
              <Building2 className="size-4" />
            </span>
            <p>Sign in to see your portfolio analytics.</p>
          </CardContent>
        </Card>
      </div>
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
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SpatialCardStack
          cards={[
            {
              eyebrow: "StarFlow · Portfolio",
              title: "Active leases",
              value: String(metrics.totalLeases),
              tone: "pink",
            },
            {
              eyebrow: "Weighted term",
              title: "Portfolio WALT",
              value:
                metrics.waltYears != null
                  ? `${metrics.waltYears.toFixed(1)} yrs`
                  : "N/A",
              tone: "mint",
            },
            {
              eyebrow: "Watchlist",
              title: "Needs review",
              value: String(metrics.needsReviewCount),
              tone: "blue",
            },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <MetricTile
              key={card.label}
              label={card.label}
              value={card.value}
              hint={card.change}
              icon={card.icon}
            />
          ))}
        </div>
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
                      className="transition-colors hover:bg-pink-400/5"
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
