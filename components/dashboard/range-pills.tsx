"use client"

import { cn } from "cn"

export const RANGE_PILL_OPTIONS = ["Day", "Week", "Month", "Year"] as const

export type RangePill = (typeof RANGE_PILL_OPTIONS)[number]

type RangePillsProps = {
  value: RangePill
  onChange: (value: RangePill) => void
}

/**
 * Outline filter pills matching the fintech reference chrome
 * (Day / Week / Month / Year). Parent owns the selected value so the
 * analytics sparkline can re-window without these becoming dead UI.
 */
export const RangePills = ({ value, onChange }: RangePillsProps) => {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-zinc-800/80 bg-zinc-950/50 p-1">
      {RANGE_PILL_OPTIONS.map((option) => {
        const isActive = option === value

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium tracking-wide transition-all",
              isActive
                ? "bg-zinc-100 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
                : "text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            )}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
