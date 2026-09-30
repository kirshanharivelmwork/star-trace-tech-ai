import Link from "next/link"

import { cn } from "cn"

type FinanceTab = "cam" | "compliance"

const TABS: { id: FinanceTab; href: string; label: string }[] = [
  { id: "cam", href: "/finances/cam", label: "CAM & OpEx" },
  { id: "compliance", href: "/finances/compliance", label: "ASC 842 / IFRS 16" },
]

export const FinanceTabs = ({ active }: { active: FinanceTab }) => {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-1">
      {TABS.map((tab) => {
        const isActive = tab.id === active
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-medium tracking-wide transition-all",
              isActive
                ? "bg-zinc-100 text-zinc-950 shadow-[0_0_18px_-6px_var(--glow-primary)]"
                : "text-zinc-400 hover:text-zinc-100"
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
