import { Scale } from "lucide-react"

import { ComplianceBoard } from "@/components/dashboard/compliance-board"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { FinanceTabs } from "@/components/dashboard/finance-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { fetchLeasePaymentTerms } from "@/lib/enterprise/queries"
import { getOrgContext } from "@/lib/org/context"

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-400">
      <Scale className="size-5 text-pink-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const ComplianceContent = async () => {
  const org = await getOrgContext()

  if (!org) {
    return <EmptyState message="Sign in to generate ASC 842 / IFRS 16 schedules." />
  }

  const terms = await fetchLeasePaymentTerms(org.orgId)
  return <ComplianceBoard terms={terms} canWrite={org.canWrite} />
}

export default function CompliancePage() {
  return (
    <DashboardShell
      title="Finances"
      description="ASC 842 / IFRS 16 · ROU asset and lease liability"
    >
      <FinanceTabs active="compliance" />
      <ComplianceContent />
    </DashboardShell>
  )
}
