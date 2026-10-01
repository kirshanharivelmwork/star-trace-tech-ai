"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Bell, CalendarClock } from "lucide-react"

import { useUser } from "@/components/providers/user-provider"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { createClient } from "@/lib/supabase/client"
import {
  getUpcomingLeaseAlerts,
  type LeaseAlert,
  type PortfolioLeaseRow,
} from "@/lib/lease/portfolio-metrics"

const ALERT_WINDOW_DAYS = 90

/**
 * Bell icon + red badge for the dashboard header. Fetches the signed-in
 * user's lease_abstracts client-side and reuses the same
 * `getUpcomingLeaseAlerts` helper as the daily cron job
 * (app/api/cron/alerts/route.ts), so "what counts as a critical date"
 * never drifts between the in-app UI and the background job.
 */
export const NotificationBell = () => {
  const { user, isLoading: isUserLoading } = useUser()
  const [alerts, setAlerts] = useState<LeaseAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (isUserLoading) return

    if (!user) {
      setAlerts([])
      setIsLoading(false)
      return
    }

    let isCancelled = false

    const fetchAlerts = async () => {
      setIsLoading(true)

      const supabase = createClient()
      const { data, error } = await supabase
        .from("lease_abstracts")
        .select("id, file_name, abstract_data")
        .eq("user_id", user.id)

      if (isCancelled) return

      if (error) {
        console.error(
          "[NotificationBell] Failed to fetch lease_abstracts:",
          error.message
        )
        setAlerts([])
        setIsLoading(false)
        return
      }

      const records = (data ?? []) as PortfolioLeaseRow[]
      setAlerts(getUpcomingLeaseAlerts(records, ALERT_WINDOW_DAYS))
      setIsLoading(false)
    }

    fetchAlerts()

    return () => {
      isCancelled = true
    }
  }, [user, isUserLoading])

  if (!user) return null

  const count = alerts.length

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative" />}
      >
        <Bell className="size-4" />
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-pink-400 text-[10px] font-medium leading-none text-zinc-950 shadow-[0_0_12px_rgba(244,168,255,0.8)]">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
        <span className="sr-only">
          Notifications{count > 0 ? ` (${count} alerts)` : ""}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">
            Lifecycle alerts
          </p>
          <span className="text-xs text-muted-foreground">
            Next {ALERT_WINDOW_DAYS} days
          </span>
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {isLoading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Loading…
            </p>
          ) : alerts.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No critical dates in the next {ALERT_WINDOW_DAYS} days.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                >
                  {alert.type === "expiration" ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="text-foreground">⚠️ {alert.message}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {alert.fileName}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
