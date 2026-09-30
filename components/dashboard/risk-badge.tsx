import { cn } from "cn"

import type { RenewalRisk } from "@/lib/telemetry/types"

const RISK_STYLES: Record<RenewalRisk, string> = {
  safe: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 shadow-[0_0_16px_-4px_rgba(52,211,153,0.75)]",
  upcoming:
    "border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_-4px_rgba(251,191,36,0.75)]",
  high: "border-red-400/40 bg-red-500/15 text-red-200 shadow-[0_0_16px_-4px_rgba(239,68,68,0.8)]",
}

const RISK_LABEL: Record<RenewalRisk, string> = {
  safe: "Safe",
  upcoming: "Negotiation window",
  high: "High vacancy risk",
}

type RiskBadgeProps = {
  risk: RenewalRisk
  className?: string
}

export const RiskBadge = ({ risk, className }: RiskBadgeProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        RISK_STYLES[risk],
        className
      )}
    >
      {RISK_LABEL[risk]}
    </span>
  )
}
