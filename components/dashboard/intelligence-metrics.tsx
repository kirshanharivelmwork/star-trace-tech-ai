import {
  Activity,
  Building2,
  Clock,
  LandPlot,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { MetricTile } from "@/components/dashboard/metric-tile"
import type { IntelligenceSnapshot } from "@/lib/telemetry/types"

const formatUsd = (value: number | null) => {
  if (value == null) return "N/A"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
  }).format(value)
}

const formatArea = (value: number | null) => {
  if (value == null) return "N/A"
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} sf`
}

const formatWalt = (value: number | null) => {
  if (value == null) return "N/A"
  return `${value.toFixed(2)} yrs`
}

type Metric = {
  label: string
  value: string
  hint: string
  icon: LucideIcon
}

type IntelligenceMetricsProps = {
  snapshot: IntelligenceSnapshot
}

export const IntelligenceMetrics = ({ snapshot }: IntelligenceMetricsProps) => {
  const metrics: Metric[] = [
    {
      label: "Portfolio valuation",
      value: formatUsd(snapshot.valuation),
      hint: `${snapshot.propertyCount} ${snapshot.propertyCount === 1 ? "asset" : "assets"}`,
      icon: Building2,
    },
    {
      label: "Net rentable area",
      value: formatArea(snapshot.nra),
      hint: "Across owned properties",
      icon: LandPlot,
    },
    {
      label: "Portfolio WALT",
      value: formatWalt(snapshot.waltYears),
      hint: "SF-weighted remaining term",
      icon: Clock,
    },
    {
      label: "Active leases",
      value: String(snapshot.activeLeaseCount),
      hint: "In-place as of today",
      icon: Activity,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricTile
          key={metric.label}
          label={metric.label}
          value={metric.value}
          hint={metric.hint}
          icon={metric.icon}
        />
      ))}
    </div>
  )
}
