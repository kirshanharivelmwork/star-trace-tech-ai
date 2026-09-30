import { Users } from "lucide-react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
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
      <Users className="size-5" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

/**
 * Server Component: aggregates the current user's lease_abstracts by
 * tenant via lib/lease/portfolio-metrics.ts#getTenantSummaries — the same
 * shared parsing module used by the Analytics page and the Overview stat
 * cards, so tenant counts here never drift from what those pages report.
 */
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
        <CardTitle className="text-sm font-medium">
          Tenants ({tenants.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Tenant</th>
                <th className="px-3 py-2 font-medium">Active leases</th>
                <th className="px-3 py-2 font-medium">Premises</th>
                <th className="px-3 py-2 font-medium">Square footage</th>
                <th className="px-3 py-2 font-medium">Nearest expiration</th>
                <th className="px-3 py-2 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map((tenant) => (
                <tr key={tenant.tenantName}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {tenant.tenantName}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {tenant.activeLeaseCount}
                    {tenant.totalLeaseCount !== tenant.activeLeaseCount ? (
                      <span className="text-muted-foreground">
                        {" "}
                        / {tenant.totalLeaseCount} total
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2 text-muted-foreground">
                    {tenant.premisesAddresses.length > 0
                      ? tenant.premisesAddresses.join("; ")
                      : "Not specified"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    Not tracked
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground">
                    {formatDate(tenant.nearestExpiration)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={RISK_BADGE_VARIANT[tenant.riskCategory]}>
                      {RISK_BADGE_LABEL[tenant.riskCategory]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="pt-3 text-xs text-muted-foreground">
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader
          title="Customers"
          description="Tenants across your lease portfolio"
        />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <CustomersContent />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
