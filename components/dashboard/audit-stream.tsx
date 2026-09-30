import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { AuditLogRow } from "@/lib/enterprise/types"

const formatTimestamp = (value: string | null) => {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

const formatDetails = (details: unknown): string => {
  if (details == null) return "—"
  if (typeof details === "string") return details
  try {
    return JSON.stringify(details)
  } catch {
    return String(details)
  }
}

type AuditStreamProps = {
  rows: AuditLogRow[]
}

export const AuditStream = ({ rows }: AuditStreamProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
          Immutable activity stream
        </CardTitle>
        <p className="text-xs text-zinc-400">
          Append-only reads from audit_logs — user actions, timestamps, and
          resource mutations.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-zinc-400">
            No audit events yet. Logging an OpEx item writes the first entry.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950 text-left text-[11px] tracking-widest text-zinc-400 uppercase">
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Resource</th>
                  <th className="px-4 py-3 font-medium">Mutation</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono text-[12px]">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-300">
                      {formatTimestamp(row.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium tracking-tight text-zinc-50">
                      {row.action ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {row.resource_type ?? "—"}
                    </td>
                    <td className="max-w-[28rem] truncate px-4 py-3 text-zinc-500">
                      {formatDetails(row.details)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-500">
                      {row.ip_address ?? "—"}
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
