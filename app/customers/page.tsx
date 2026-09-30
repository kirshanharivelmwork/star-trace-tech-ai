import { Users } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getTenantSummaries,
  type PortfolioLeaseRow,
  type RiskCategory,
} from "@/lib/lease/portfolio-metrics"
import { createClient } from "@/lib/supabase/server"

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

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Users className="size-5 text-violet-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const CustomersContent = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <EmptyState message="Sign in to see your tenants." />
  }

  const { data, error } = await supabase
    .from("lease_abstracts")
    .select("id, file_name, abstract_data")
    .eq("user_id", user.id)

  if (error) {
    console.error(
      "[CustomersPage] Failed to fetch lease_abstracts:",
      error.message
    )
  }

  const records = (data ?? []) as PortfolioLeaseRow[]

  if (records.length === 0) {
    return (
      <EmptyState message="No tenants yet — upload a lease from the Overview page to get started." />
    )
  }

  const tenants = getTenantSummaries(records)

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
              {tenants.map((tenant) => (
                <tr
                  key={tenant.tenantName}
                  className="transition-colors hover:bg-violet-500/5"
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
                    {tenant.premisesAddresses.length > 0
                      ? tenant.premisesAddresses.join("; ")
                      : "Not specified"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">Not tracked</td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                    {formatDate(tenant.nearestExpiration)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={RISK_BADGE_VARIANT[tenant.riskCategory]}>
                      {RISK_BADGE_LABEL[tenant.riskCategory]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="pt-3 text-xs text-zinc-500">
          Square footage isn&apos;t captured by the lease abstraction schema
          yet, so it can&apos;t be shown per tenant — flagging this rather
          than guessing a value.
        </p>
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
