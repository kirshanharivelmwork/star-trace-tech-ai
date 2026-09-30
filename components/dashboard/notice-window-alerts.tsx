import { AlertTriangle } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchNoticeAlerts } from "@/lib/enterprise/queries"
import type { NoticePriority } from "@/lib/enterprise/types"
import { createClient } from "@/lib/supabase/server"

const PRIORITY_STYLES: Record<NoticePriority, string> = {
  critical:
    "border-red-400/40 bg-red-500/15 text-red-200 shadow-[0_0_16px_-4px_rgba(239,68,68,0.8)]",
  high: "border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_-4px_rgba(251,191,36,0.75)]",
  watch:
    "border-violet-400/40 bg-violet-500/15 text-violet-200 shadow-[0_0_16px_-4px_var(--glow-primary)]",
}

const PRIORITY_LABEL: Record<NoticePriority, string> = {
  critical: "High priority",
  high: "Elevated",
  watch: "Watch",
}

const formatDate = (date: Date | null) =>
  date
    ? date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

const daysCopy = (days: number | null) => {
  if (days == null) return "No target date"
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return "Due today"
  return `${days}d remaining`
}

export const NoticeWindowAlerts = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card className="border-zinc-800/80 bg-zinc-900/60 shadow-2xl backdrop-blur-xl">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-400">
          <AlertTriangle className="size-5 text-violet-300" />
          <p>Sign in to see upcoming notice-window alerts.</p>
        </CardContent>
      </Card>
    )
  }

  const alerts = await fetchNoticeAlerts(user.id)
  const visible = alerts.filter(
    (alert) => alert.daysUntil == null || alert.daysUntil <= 180
  )
  const highPriority = visible.filter((alert) => alert.priority === "critical").length

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/60 shadow-2xl backdrop-blur-xl">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Notice windows
          </CardTitle>
          <p className="text-xs text-zinc-400">
            Upcoming exercise / expiration notice deadlines
          </p>
        </div>
        {highPriority > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/15 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-red-200 shadow-[0_0_16px_-4px_rgba(239,68,68,0.8)]">
            <AlertTriangle className="size-3" />
            {highPriority} high priority
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="py-4 text-sm text-zinc-400">
            No notice windows in the next 180 days.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.slice(0, 8).map((alert) => (
              <li
                key={alert.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium tracking-tight text-zinc-50">
                    {alert.tenantName}
                  </p>
                  <p className="truncate text-xs text-zinc-400">
                    {alert.propertyName ?? "Unassigned asset"} ·{" "}
                    {formatDate(alert.targetDate)}
                    {alert.status ? ` · ${alert.status}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${PRIORITY_STYLES[alert.priority]}`}
                  >
                    {PRIORITY_LABEL[alert.priority]}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {daysCopy(alert.daysUntil)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
