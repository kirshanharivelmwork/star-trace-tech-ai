import { BarChart3, Clock, FileWarning, TrendingUp } from "lucide-react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  calculatePortfolioMetrics,
  getExpirationTimelineBuckets,
  getRiskBreakdown,
  type PortfolioLeaseRow,
  type RiskCategory,
} from "@/lib/lease/portfolio-metrics"
import { createClient } from "@/lib/supabase/server"

const RISK_COLOR_CLASSES: Record<RiskCategory, string> = {
  critical: "bg-red-500",
  upcoming: "bg-amber-500",
  healthy: "bg-emerald-500",
  needs_review: "bg-zinc-500",
}

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <BarChart3 className="size-5" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

/**
 * Server Component: fetches the current user's lease_abstracts and
 * derives portfolio-wide risk/timeline analytics from
 * lib/lease/portfolio-metrics.ts — the same shared parsing/aggregation
 * module used by components/dashboard/portfolio-analytics.tsx (Overview
 * stat cards) and app/customers/page.tsx, so all three surfaces stay
 * numerically consistent.
 */
const AnalyticsContent = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <EmptyState message="Sign in to see your portfolio analytics." />
  }

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("id, file_name, abstract_data")
    .eq("user_id", user.id)

  if (error) {
    console.error(
      "[AnalyticsPage] Failed to fetch lease_abstracts:",
      error.message
    )
  }

  const records = (data ?? []) as PortfolioLeaseRow[]

  if (records.length === 0) {
    return (
      <EmptyState message="No leases yet — upload one from the Overview page to see analytics here." />
    )
  }

  const metrics = calculatePortfolioMetrics(records)
  const riskBreakdown = getRiskBreakdown(records)
  const timeline = getExpirationTimelineBuckets(records)

  const maxRiskCount = Math.max(1, ...riskBreakdown.map((entry) => entry.count))
  const maxTimelineCount = Math.max(1, ...timeline.map((bucket) => bucket.count))

  const statCards = [
    {
      label: "Portfolio WALT",
      value:
        metrics.waltYears != null ? `${metrics.waltYears.toFixed(1)} yrs` : "N/A",
      change: "Equal-weighted average lease term",
      icon: Clock,
    },
    {
      label: "Total Leases",
      value: String(metrics.totalLeases),
      change: "Across your portfolio",
      icon: BarChart3,
    },
    {
      label: "Upcoming Expirations",
      value: String(metrics.upcomingExpirations),
      change: "Within the next 24 months",
      icon: TrendingUp,
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
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Risk breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {riskBreakdown.map((entry) => (
              <div key={entry.category} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-foreground">
                    <span
                      className={`size-2 rounded-full ${RISK_COLOR_CLASSES[entry.category]}`}
                    />
                    {entry.label}
                  </span>
                  <span className="font-medium text-foreground">
                    {entry.count}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${RISK_COLOR_CLASSES[entry.category]}`}
                    style={{
                      width: `${(entry.count / maxRiskCount) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Expiration timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {timeline.map((bucket) => (
              <div key={bucket.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{bucket.label}</span>
                  <span className="font-medium text-foreground">
                    {bucket.count}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-amber-500"
                    style={{
                      width: `${(bucket.count / maxTimelineCount) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Excludes already-expired leases and leases with no parseable
              expiration date.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader
          title="Analytics"
          description="Portfolio-wide lease performance and risk"
        />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <AnalyticsContent />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
