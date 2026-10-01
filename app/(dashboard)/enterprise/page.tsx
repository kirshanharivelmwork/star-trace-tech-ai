import { Radar } from "lucide-react"

import {
  EnterpriseCommandCenter,
  type EnterpriseTab,
} from "@/components/dashboard/enterprise-command-center"
import {
  CamPanel,
  CompliancePanel,
  SecurityPanel,
  TelemetryPanel,
} from "@/components/dashboard/enterprise-panels"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Card, CardContent } from "@/components/ui/card"
import {
  fetchAuditLogs,
  fetchCamSnapshot,
  fetchLeasePaymentTerms,
  fetchNoticeAlerts,
} from "@/lib/enterprise/queries"
import { fetchPortfolioIntelligence } from "@/lib/telemetry/queries"
import { getOrgContext } from "@/lib/org/context"

const panelEmpty = (message: string) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-400">
      <Radar className="size-5 text-pink-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const ZERO_COUNTS: Record<EnterpriseTab, number> = {
  telemetry: 0,
  cam: 0,
  compliance: 0,
  security: 0,
}

const EnterpriseContent = async () => {
  const org = await getOrgContext()

  if (!org) {
    const message = "Sign in to load this section of the command center."
    return (
      <EnterpriseCommandCenter
        counts={ZERO_COUNTS}
        panels={{
          telemetry: panelEmpty(message),
          cam: panelEmpty(message),
          compliance: panelEmpty(message),
          security: panelEmpty(message),
        }}
      />
    )
  }

  const [snapshot, cam, terms, logs, alerts] = await Promise.all([
    fetchPortfolioIntelligence(org.orgId, org.userId),
    fetchCamSnapshot(org.orgId),
    fetchLeasePaymentTerms(org.orgId),
    fetchAuditLogs(org.orgId),
    fetchNoticeAlerts(org.orgId),
  ])

  const criticalNotices = alerts.filter(
    (alert) => alert.priority === "critical"
  ).length

  const counts: Record<EnterpriseTab, number> = {
    telemetry: snapshot.activeLeaseCount,
    cam: cam.expenses.length,
    compliance: terms.length,
    security: logs.length + criticalNotices,
  }

  return (
    <EnterpriseCommandCenter
      counts={counts}
      panels={{
        telemetry: <TelemetryPanel snapshot={snapshot} />,
        cam: <CamPanel snapshot={cam} />,
        compliance: <CompliancePanel terms={terms} canWrite={org.canWrite} />,
        security: <SecurityPanel alerts={alerts} logs={logs} />,
      }}
    />
  )
}

export default function EnterprisePage() {
  return (
    <DashboardShell
      title="Enterprise"
      description="Command center · telemetry, CAM, ASC 842, and audit"
    >
      <EnterpriseContent />
    </DashboardShell>
  )
}
