import { BarChart3 } from "lucide-react"

import { AuditStream } from "@/components/dashboard/audit-stream"
import { CamBoard } from "@/components/dashboard/cam-board"
import { ComplianceBoard } from "@/components/dashboard/compliance-board"
import { ExpirationFunnel } from "@/components/dashboard/expiration-funnel"
import {
  IntelligenceBoard,
  IntelligenceRiskMix,
} from "@/components/dashboard/intelligence-board"
import { IntelligenceMetrics } from "@/components/dashboard/intelligence-metrics"
import { NoticeWindowPanel } from "@/components/dashboard/notice-window-alerts"
import { TenantRiskTable } from "@/components/dashboard/tenant-risk-table"
import { Card, CardContent } from "@/components/ui/card"
import type { AuditLogRow, CamSnapshot, LeasePaymentTerm, NoticeAlert } from "@/lib/enterprise/types"
import type { IntelligenceSnapshot } from "@/lib/telemetry/types"

const hasTelemetry = (snapshot: IntelligenceSnapshot) =>
  snapshot.propertyCount > 0 ||
  snapshot.activeLeaseCount > 0 ||
  snapshot.tenantRisk.length > 0 ||
  snapshot.valuation != null

export const TelemetryPanel = ({
  snapshot,
}: {
  snapshot: IntelligenceSnapshot
}) => {
  return (
    <div className="flex flex-col gap-6">
      {!hasTelemetry(snapshot) ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-400">
            <BarChart3 className="size-5 text-pink-300" />
            <p>
              No telemetry yet. Valuation, NRA, and WALT stay at N/A until
              properties and leases are on file.
            </p>
          </CardContent>
        </Card>
      ) : null}

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

export const CamPanel = ({ snapshot }: { snapshot: CamSnapshot }) => {
  return <CamBoard snapshot={snapshot} />
}

export const CompliancePanel = ({
  terms,
  canWrite = false,
}: {
  terms: LeasePaymentTerm[]
  canWrite?: boolean
}) => {
  return <ComplianceBoard terms={terms} canWrite={canWrite} />
}

export const SecurityPanel = ({
  alerts,
  logs,
}: {
  alerts: NoticeAlert[]
  logs: AuditLogRow[]
}) => {
  return (
    <div className="flex flex-col gap-6">
      <NoticeWindowPanel alerts={alerts} horizonDays={null} limit={20} />
      <AuditStream rows={logs} />
    </div>
  )
}
