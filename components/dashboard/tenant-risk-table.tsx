import { RiskBadge } from "@/components/dashboard/risk-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RenewalRisk, TenantRiskRow } from "@/lib/telemetry/types"

const formatDate = (date: Date | null) =>
  date
    ? date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

const formatUsd = (value: number | null) => {
  if (value == null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

type TenantRiskTableProps = {
  rows: TenantRiskRow[]
  counts: Record<RenewalRisk, number>
}

export const TenantRiskTable = ({ rows, counts }: TenantRiskTableProps) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Tenant churn risk
          </CardTitle>
          <p className="text-xs text-zinc-400">
            Live signals from tenant_risk_telemetry
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RiskBadge risk="high" />
          <span className="text-xs text-zinc-500">{counts.high}</span>
          <RiskBadge risk="upcoming" />
          <span className="text-xs text-zinc-500">{counts.upcoming}</span>
          <RiskBadge risk="safe" />
          <span className="text-xs text-zinc-500">{counts.safe}</span>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-zinc-400">
            No tenant risk telemetry yet for this portfolio.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="px-4 py-3 font-medium">Days left</th>
                  <th className="px-4 py-3 font-medium">Rent / mo</th>
                  <th className="px-4 py-3 font-medium">SF</th>
                  <th className="px-4 py-3 font-medium">Churn</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {rows.map((row) => (
                  <tr
                    key={row.telemetryId}
                    className="transition-colors hover:bg-pink-400/5"
                  >
                    <td className="px-4 py-3 font-medium tracking-tight text-zinc-50">
                      {row.tenantName}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {row.propertyName ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                      {formatDate(row.expirationDate)}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      {row.daysUntilExpiry == null ? "—" : row.daysUntilExpiry}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      {formatUsd(row.monthlyRent)}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      {row.squareFootage == null
                        ? "—"
                        : new Intl.NumberFormat("en-US").format(row.squareFootage)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {row.churnScore == null
                        ? "—"
                        : row.churnScore > 1
                          ? row.churnScore.toFixed(0)
                          : row.churnScore.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge risk={row.risk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
