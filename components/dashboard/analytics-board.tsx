"use client"

import { useMemo, useState } from "react"

import { GlowChart } from "@/components/dashboard/glow-chart"
import {
  RangePills,
  type RangePill,
} from "@/components/dashboard/range-pills"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type {
  ExpirationTimelineBucket,
  RiskBreakdownEntry,
  RiskCategory,
} from "@/lib/lease/portfolio-metrics"

const RISK_COLOR_CLASSES: Record<RiskCategory, string> = {
  critical: "bg-red-500 shadow-[0_0_12px_-2px_rgba(239,68,68,0.7)]",
  upcoming: "bg-amber-400 shadow-[0_0_12px_-2px_rgba(251,191,36,0.6)]",
  healthy: "bg-emerald-400 shadow-[0_0_12px_-2px_rgba(52,211,153,0.55)]",
  needs_review: "bg-zinc-500",
}

type AnalyticsBoardProps = {
  riskBreakdown: RiskBreakdownEntry[]
  timeline: ExpirationTimelineBucket[]
}

const RANGE_SLICE: Record<RangePill, number> = {
  Day: 1,
  Week: 2,
  Month: 3,
  Year: 4,
}

/**
 * Client island for the Analytics page's visual layer: range pills +
 * glowing area chart + risk bars. Data is computed on the server and
 * passed in so this file never talks to Supabase.
 */
export const AnalyticsBoard = ({
  riskBreakdown,
  timeline,
}: AnalyticsBoardProps) => {
  const [range, setRange] = useState<RangePill>("Month")

  const visibleTimeline = useMemo(
    () => timeline.slice(0, RANGE_SLICE[range]),
    [range, timeline]
  )

  const maxRiskCount = Math.max(1, ...riskBreakdown.map((entry) => entry.count))
  const maxTimelineCount = Math.max(
    1,
    ...visibleTimeline.map((bucket) => bucket.count)
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm font-medium tracking-tight">
              Expiration mix
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Remaining term distribution for leases with a parseable date
            </p>
          </div>
          <RangePills value={range} onChange={setRange} />
        </CardHeader>
        <CardContent>
          <GlowChart
            values={
              visibleTimeline.length < 2
                ? [
                    visibleTimeline[0]?.count ?? 0,
                    visibleTimeline[0]?.count ?? 0,
                  ]
                : visibleTimeline.map((bucket) => bucket.count)
            }
            labels={
              visibleTimeline.length < 2
                ? [
                    visibleTimeline[0]?.label ?? "",
                    visibleTimeline[0]?.label ?? "",
                  ]
                : visibleTimeline.map((bucket) => bucket.label)
            }
          />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] tracking-wide text-zinc-500 uppercase">
            {visibleTimeline.map((bucket) => (
              <span key={bucket.label}>
                {bucket.label}
                <span className="ml-1 text-zinc-300">{bucket.count}</span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight">
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
                <span className="font-medium tracking-tight text-foreground">
                  {entry.count}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
                <div
                  className={`h-1.5 rounded-full ${RISK_COLOR_CLASSES[entry.category]}`}
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
          <CardTitle className="text-sm font-medium tracking-tight">
            Expiration timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {visibleTimeline.map((bucket) => (
            <div key={bucket.label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{bucket.label}</span>
                <span className="font-medium text-foreground">
                  {bucket.count}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-pink-300 to-fuchsia-300 shadow-[0_0_12px_-2px_var(--glow-primary)]"
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
  )
}
