import { OpexLedgerForm } from "@/components/dashboard/opex-ledger-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CamSnapshot } from "@/lib/enterprise/types"

const formatUsd = (value: number | null) => {
  if (value == null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

const formatDate = (value: string | null) => {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type CamBoardProps = {
  snapshot: CamSnapshot
}

export const CamBoard = ({ snapshot }: CamBoardProps) => {
  const totalOpEx = snapshot.expenses.reduce(
    (sum, row) => sum + (row.amount ?? 0),
    0
  )
  const totalAllocated = snapshot.allocations.reduce(
    (sum, row) => sum + (row.allocatedAmount ?? 0),
    0
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Log building expense
          </CardTitle>
          <p className="text-xs text-zinc-400">
            Tenant shares are computed as lease SF ÷ property NRA, then written
            to tenant_cam_allocations.
          </p>
        </CardHeader>
        <CardContent>
          <OpexLedgerForm properties={snapshot.properties} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
              Posted OpEx
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-zinc-50">
              {formatUsd(totalOpEx)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {snapshot.expenses.length} ledger{" "}
              {snapshot.expenses.length === 1 ? "line" : "lines"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
              Allocated CAM
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-zinc-50">
              {formatUsd(totalAllocated)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {snapshot.allocations.length} tenant{" "}
              {snapshot.allocations.length === 1 ? "share" : "shares"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Operating expense ledger
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.expenses.length === 0 ? (
            <p className="py-6 text-sm text-zinc-400">
              No operating expenses posted yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {snapshot.expenses.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-pink-400/5">
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                        {formatDate(row.incurredDate)}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {row.propertyName ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-medium tracking-tight text-zinc-50">
                        {row.category ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-200">
                        {formatUsd(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Tenant CAM allocations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.allocations.length === 0 ? (
            <p className="py-6 text-sm text-zinc-400">
              No prorated tenant shares yet — log an expense to generate them.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-950/50 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
                    <th className="px-4 py-3 font-medium">Tenant</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Allocated</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {snapshot.allocations.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-pink-400/5">
                      <td className="px-4 py-3 font-medium tracking-tight text-zinc-50">
                        {row.tenantName}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {row.propertyName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {row.category ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-200">
                        {formatUsd(row.allocatedAmount)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {row.status ?? "—"}
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
