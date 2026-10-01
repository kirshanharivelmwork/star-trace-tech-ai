import { BarChart3 } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ExpirationFunnel } from "@/components/dashboard/expiration-funnel"
import { IntelligenceBoard, IntelligenceRiskMix } from "@/components/dashboard/intelligence-board"
import { IntelligenceMetrics } from "@/components/dashboard/intelligence-metrics"
import { TenantRiskTable } from "@/components/dashboard/tenant-risk-table"
import { Card, CardContent } from "@/components/ui/card"
import { fetchPortfolioIntelligence } from "@/lib/telemetry/queries"
import { getOrgContext } from "@/lib/org/context"

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-400">
      <BarChart3 className="size-5 text-pink-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const AnalyticsContent = async () => {
  const org = await getOrgContext()

  if (!org) {
    return <EmptyState message="Sign in to see corporate intelligence." />
  }

  const snapshot = await fetchPortfolioIntelligence(org.orgId, org.userId)
  const hasAnything =
    snapshot.propertyCount > 0 ||
    snapshot.activeLeaseCount > 0 ||
    snapshot.tenantRisk.length > 0 ||
    snapshot.valuation != null

  if (!hasAnything) {
    return (
      <EmptyState message="No leases yet — upload a PDF on Overview to create the first property and lease record." />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <IntelligenceMetrics snapshot={snapshot} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpirationFunnel buckets={snapshot.quarterlyFunnel} />
        <IntelligenceRiskMix riskCounts={snapshot.riskCounts} />
      </div>

      <IntelligenceBoard
        expirationSeries={snapshot.expirationSeries}
        expirationLabels={snapshot.expirationLabels}
      />

      <TenantRiskTable rows={snapshot.tenantRisk} counts={snapshot.riskCounts} />
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <DashboardShell
      title="Analytics"
      description="Corporate intelligence · portfolio, WALT, and tenant risk"
    >
      <AnalyticsContent />
    </DashboardShell>
  )
}
