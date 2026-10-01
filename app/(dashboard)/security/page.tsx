import { Shield } from "lucide-react"

import { AuditStream } from "@/components/dashboard/audit-stream"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Card, CardContent } from "@/components/ui/card"
import { fetchAuditLogs } from "@/lib/enterprise/queries"
import { getOrgContext } from "@/lib/org/context"

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-400">
      <Shield className="size-5 text-zinc-400" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const SecurityContent = async () => {
  const org = await getOrgContext()

  if (!org) {
    return <EmptyState message="Sign in to open the institutional data room." />
  }

  const rows = await fetchAuditLogs(org.orgId)
  return <AuditStream rows={rows} />
}

export default function SecurityPage() {
  return (
    <DashboardShell
      title="Data room"
      description="Tamper-evident audit trail · append-only activity log"
    >
      <SecurityContent />
    </DashboardShell>
  )
}
