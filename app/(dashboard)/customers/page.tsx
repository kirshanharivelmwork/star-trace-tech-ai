import { Users } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { loadOwnedPortfolio } from "@/lib/enterprise/queries"
import {
  categorizeLeaseExpirationRisk,
  type RiskCategory,
} from "@/lib/lease/portfolio-metrics"
import { getOrgContext } from "@/lib/org/context"
import { parseIsoDate } from "@/lib/enterprise/metrics"
import { toNumber } from "@/lib/telemetry/metrics"

const RISK_BADGE_VARIANT: Record<
  RiskCategory,
  "default" | "secondary" | "destructive" | "outline"
> = {
  critical: "destructive",
  upcoming: "secondary",
  healthy: "outline",
  needs_review: "outline",
}

const RISK_BADGE_LABEL: Record<RiskCategory, string> = {
  critical: "Critical",
  upcoming: "Upcoming",
  healthy: "Healthy",
  needs_review: "Needs review",
}

const formatDate = (date: Date | null) =>
  date
    ? date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

const formatSf = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US").format(value) + " sf"

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Users className="size-5 text-pink-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const CustomersContent = async () => {
  const org = await getOrgContext()

  if (!org) {
    return <EmptyState message="Sign in to see your tenants." />
  }

  const { properties, leases } = await loadOwnedPortfolio(org.orgId)
  const propertyById = new Map(properties.map((property) => [property.id, property]))

  if (leases.length === 0) {
    return (
      <EmptyState message="No tenants yet — upload a lease from the Overview page to create the first record." />
    )
  }

  const now = new Date()
  const byTenant = new Map<
    string,
    {
      tenantName: string
      activeLeaseCount: number
      totalLeaseCount: number
      premises: Set<string>
      squareFootage: number
      hasSf: boolean
      nearestExpiration: Date | null
    }
  >()

  for (const lease of leases) {
    const tenantName = lease.tenant_name?.trim() || "Unnamed tenant"
    const existing = byTenant.get(tenantName) ?? {
      tenantName,
      activeLeaseCount: 0,
      totalLeaseCount: 0,
      premises: new Set<string>(),
      squareFootage: 0,
      hasSf: false,
      nearestExpiration: null as Date | null,
    }

    existing.totalLeaseCount += 1
    const expiration = parseIsoDate(lease.end_date)
    if (!expiration || expiration.getTime() >= now.getTime()) {
      existing.activeLeaseCount += 1
    }
    if (
      expiration &&
      (!existing.nearestExpiration ||
        expiration.getTime() < existing.nearestExpiration.getTime())
    ) {
      existing.nearestExpiration = expiration
    }

    const sf = toNumber(lease.square_footage)
    if (sf != null && sf > 0) {
      existing.squareFootage += sf
      existing.hasSf = true
    }

    const property = lease.property_id ? propertyById.get(lease.property_id) : undefined
    const premises = property?.address?.trim() || property?.name?.trim()
    if (premises) existing.premises.add(premises)

    byTenant.set(tenantName, existing)
  }

  const tenants = [...byTenant.values()].sort((a, b) =>
    a.tenantName.localeCompare(b.tenantName)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-tight">
          Tenants ({tenants.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Active leases</th>
                <th className="px-4 py-3 font-medium">Premises</th>
                <th className="px-4 py-3 font-medium">Square footage</th>
                <th className="px-4 py-3 font-medium">Nearest expiration</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {tenants.map((tenant) => {
                const risk = categorizeLeaseExpirationRisk(
                  tenant.nearestExpiration,
                  now
                )
                return (
                  <tr
                    key={tenant.tenantName}
                    className="transition-colors hover:bg-pink-400/5"
                  >
                    <td className="px-4 py-3 font-medium tracking-tight text-zinc-50">
                      {tenant.tenantName}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      {tenant.activeLeaseCount}
                      {tenant.totalLeaseCount !== tenant.activeLeaseCount ? (
                        <span className="text-zinc-500">
                          {" "}
                          / {tenant.totalLeaseCount} total
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-zinc-400">
                      {tenant.premises.size > 0
                        ? [...tenant.premises].join("; ")
                        : "Not specified"}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      {formatSf(tenant.hasSf ? tenant.squareFootage : null)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                      {formatDate(tenant.nearestExpiration)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={RISK_BADGE_VARIANT[risk]}>
                        {RISK_BADGE_LABEL[risk]}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CustomersPage() {
  return (
    <DashboardShell
      title="Customers"
      description="Tenants across your lease portfolio"
    >
      <CustomersContent />
    </DashboardShell>
  )
}
