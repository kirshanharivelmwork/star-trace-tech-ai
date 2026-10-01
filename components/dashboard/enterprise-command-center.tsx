"use client"

import { useState, type ReactNode } from "react"
import {
  Landmark,
  Scale,
  Shield,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

export const ENTERPRISE_TABS = [
  "telemetry",
  "cam",
  "compliance",
  "security",
] as const

export type EnterpriseTab = (typeof ENTERPRISE_TABS)[number]

const TAB_META: Record<
  EnterpriseTab,
  { label: string; hint: string; icon: LucideIcon }
> = {
  telemetry: {
    label: "Portfolio & WALT",
    hint: "Valuation, NRA, and tenant risk",
    icon: Sparkles,
  },
  cam: {
    label: "CAM / OpEx",
    hint: "Ledger and tenant allocations",
    icon: Landmark,
  },
  compliance: {
    label: "ASC 842 / IFRS 16",
    hint: "ROU asset and lease liability",
    icon: Scale,
  },
  security: {
    label: "Audit & notices",
    hint: "Activity stream and escalations",
    icon: Shield,
  },
}

type EnterpriseCommandCenterProps = {
  counts: Record<EnterpriseTab, number>
  panels: Record<EnterpriseTab, ReactNode>
}

export const EnterpriseCommandCenter = ({
  counts,
  panels,
}: EnterpriseCommandCenterProps) => {
  const [tab, setTab] = useState<EnterpriseTab>("telemetry")
  const active = TAB_META[tab]

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Enterprise command center"
        className="grid grid-cols-2 gap-1 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-1 shadow-2xl backdrop-blur-xl lg:grid-cols-4"
      >
        {ENTERPRISE_TABS.map((id) => {
          const meta = TAB_META[id]
          const isActive = id === tab
          const Icon = meta.icon

          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-all",
                isActive
                  ? "bg-pink-200 text-zinc-950 shadow-[0_0_22px_-8px_var(--glow-primary)]"
                  : "text-zinc-400 hover:bg-zinc-950/40 hover:text-zinc-100"
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-medium tracking-wide">
                  {meta.label}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums",
                  isActive ? "bg-zinc-950/10 text-zinc-700" : "text-zinc-500"
                )}
              >
                {counts[id]}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-xs tracking-wide text-zinc-500">{active.hint}</p>

      <div
        key={tab}
        role="tabpanel"
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        {panels[tab]}
      </div>
    </div>
  )
}
