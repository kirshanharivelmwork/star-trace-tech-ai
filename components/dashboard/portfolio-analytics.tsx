import type { ReactNode } from "react"
import { AlertCircle, Building2, Clock, FileWarning } from "lucide-react"

import { MetricTile } from "@/components/dashboard/metric-tile"
import { SpatialCardStack } from "@/components/dashboard/spatial-card-stack"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { loadOwnedPortfolio } from "@/lib/enterprise/queries"
import { parseIsoDate, remainingWholeMonths } from "@/lib/enterprise/metrics"
import { getOrgContext } from "@/lib/org/context"
import { calculateWaltYears, isActiveLease } from "@/lib/telemetry/metrics"
import { toNumber } from "@/lib/telemetry/metrics"

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

const daysUntil = (date: Date) => {
  const now = new Date()
  return Math.max(
    0,
    Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  )
}

type MetricCard = {
  label: string
  value: string
  change: string
  icon: ReactNode
}

export const PortfolioAnalytics = async () => {
  const org = await getOrgContext()

  if (!org) {
    return (
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SpatialCardStack
          cards={[
            {
              eyebrow: "StarFlow · Portfolio",
              title: "Active leases",
              value: "—",
              tone: "pink",
            },
            {
              eyebrow: "Weighted term",
              title: "Portfolio WALT",
              value: "—",
              tone: "mint",
            },
            {
              eyebrow: "Watchlist",
              title: "Needs review",
              value: "—",
              tone: "blue",
            },
          ]}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <span className="icon-well size-10">
              <Building2 className="size-4" />
            </span>
            <p>Sign in to see your portfolio analytics.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { properties, propertyById, leases } = await loadOwnedPortfolio(org.orgId)
  const now = new Date()
  const windowEnd = new Date(now)
  windowEnd.setMonth(windowEnd.getMonth() + 24)

  const active = leases.filter((lease) => isActiveLease(lease, now))
  const waltYears = calculateWaltYears(active, now)
  const needsReviewCount = leases.filter((lease) => lease.needs_review).length

  const upcomingExpirations = active.filter((lease) => {
    const expiration = parseIsoDate(lease.end_date)
    if (!expiration) return false
    return (
      expiration.getTime() >= now.getTime() &&
      expiration.getTime() <= windowEnd.getTime()
    )
  }).length
  const criticalDates = active
    .map((lease) => {
      const expiration = parseIsoDate(lease.end_date)
      if (!expiration || expiration.getTime() < now.getTime()) return null
      const property = lease.property_id
        ? propertyById.get(lease.property_id)
        : undefined
      return {
        id: lease.id,
        tenantName: lease.tenant_name?.trim() || "Unnamed tenant",
        propertyName: property?.name ?? null,
        expirationDate: expiration,
        remainingMonths: remainingWholeMonths(expiration, now),
        monthlyRent: toNumber(lease.monthly_rent),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())
    .slice(0, 3)

  const cards: MetricCard[] = [
    {
      label: "Total Leases",
      value: String(leases.length),
      change:
        leases.length === 0
          ? "No leases on file yet"
          : `${properties.length} ${properties.length === 1 ? "property" : "properties"}`,
      icon: <Building2 className="h-4 w-4" />,
    },
    {
      label: "Upcoming Expirations",
      value: String(upcomingExpirations),
      change: "Within the next 24 months",
      icon: <AlertCircle className="h-4 w-4" />,
    },
    {
      label: "Portfolio WALT",
      value: waltYears != null ? `${waltYears.toFixed(1)} yrs` : "N/A",
      change:
        waltYears != null
          ? "Weighted average lease term"
          : "No parseable remaining terms yet",
      icon: <Clock className="h-4 w-4" />,
    },
    {
      label: "Needs Review",
      value: String(needsReviewCount),
      change: "Missing dates or rent on the canonical lease",
      icon: <FileWarning className="h-4 w-4" />,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SpatialCardStack
          cards={[
            {
              eyebrow: "StarFlow · Portfolio",
              title: "Active leases",
              value: String(active.length),
              tone: "pink",
            },
            {
              eyebrow: "Weighted term",
              title: "Portfolio WALT",
              value: waltYears != null ? `${waltYears.toFixed(1)} yrs` : "N/A",
              tone: "mint",
            },
            {
              eyebrow: "Watchlist",
              title: "Needs review",
              value: String(needsReviewCount),
              tone: "blue",
            },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <MetricTile
              key={card.label}
              label={card.label}
              value={card.value}
              hint={card.change}
              icon={card.icon}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Critical Upcoming Dates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {criticalDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming expirations with a parseable date yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                    <th className="px-4 py-3 font-medium">Lease</th>
                    <th className="px-4 py-3 font-medium">Expiration</th>
                    <th className="px-4 py-3 font-medium">Days left</th>
                    <th className="px-4 py-3 font-medium">Rent / mo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {criticalDates.map((entry) => (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-pink-400/5"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium tracking-tight text-zinc-50">
                          {entry.tenantName}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {entry.propertyName ?? "Unassigned asset"}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {formatDate(entry.expirationDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {daysUntil(entry.expirationDate)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {entry.monthlyRent == null
                          ? "—"
                          : new Intl.NumberFormat("en-US", {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 0,
                            }).format(entry.monthlyRent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
