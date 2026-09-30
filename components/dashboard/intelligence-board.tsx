"use client"

import { useMemo, useState } from "react"

import { GlowChart } from "@/components/dashboard/glow-chart"
import {
  RangePills,
  type RangePill,
} from "@/components/dashboard/range-pills"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RenewalRisk } from "@/lib/telemetry/types"

const RISK_COLOR_CLASSES: Record<RenewalRisk, string> = {
  high: "bg-red-500 shadow-[0_0_12px_-2px_rgba(239,68,68,0.7)]",
  upcoming: "bg-amber-400 shadow-[0_0_12px_-2px_rgba(251,191,36,0.6)]",
  safe: "bg-emerald-400 shadow-[0_0_12px_-2px_rgba(52,211,153,0.55)]",
}

const RISK_LABEL: Record<RenewalRisk, string> = {
  high: "High vacancy risk",
  upcoming: "Upcoming negotiation",
  safe: "Safe / in place",
}

type IntelligenceBoardProps = {
  expirationSeries: number[]
  expirationLabels: string[]
}

const RANGE_SLICE: Record<RangePill, number> = {
  Day: 1,
  Week: 2,
  Month: 3,
  Year: 4,
}

export const IntelligenceBoard = ({
  expirationSeries,
  expirationLabels,
}: IntelligenceBoardProps) => {
  const [range, setRange] = useState<RangePill>("Year")

  const visibleValues = useMemo(
    () => expirationSeries.slice(0, RANGE_SLICE[range]),
    [expirationSeries, range]
  )
  const visibleLabels = useMemo(
    () => expirationLabels.slice(0, RANGE_SLICE[range]),
    [expirationLabels, range]
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium tracking-tight">
            Expiration mix
          </CardTitle>
          <p className="text-xs text-zinc-400">
            Forward calendar quarters of in-place lease expiries
          </p>
        </div>
        <RangePills value={range} onChange={setRange} />
      </CardHeader>
      <CardContent>
        <GlowChart
          values={
            visibleValues.length < 2
              ? [visibleValues[0] ?? 0, visibleValues[0] ?? 0]
              : visibleValues
          }
          labels={
            visibleLabels.length < 2
              ? [visibleLabels[0] ?? "", visibleLabels[0] ?? ""]
              : visibleLabels
          }
        />
      </CardContent>
    </Card>
  )
}

export const IntelligenceRiskMix = ({
  riskCounts,
}: {
  riskCounts: Record<RenewalRisk, number>
}) => {
  const riskEntries = (["high", "upcoming", "safe"] as const).map((key) => ({
    key,
    count: riskCounts[key],
  }))
  const maxRisk = Math.max(1, ...riskEntries.map((entry) => entry.count))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-tight">
          Risk mix
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {riskEntries.map((entry) => (
          <div key={entry.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-zinc-200">
                <span
                  className={`size-2 rounded-full ${RISK_COLOR_CLASSES[entry.key]}`}
                />
                {RISK_LABEL[entry.key]}
              </span>
              <span className="font-medium text-zinc-50">{entry.count}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className={`h-1.5 rounded-full ${RISK_COLOR_CLASSES[entry.key]}`}
                style={{ width: `${(entry.count / maxRisk) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
