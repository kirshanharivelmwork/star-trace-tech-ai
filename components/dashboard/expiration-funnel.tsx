import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { QuarterlyFunnelBucket } from "@/lib/telemetry/types"

type ExpirationFunnelProps = {
  buckets: QuarterlyFunnelBucket[]
}

export const ExpirationFunnel = ({ buckets }: ExpirationFunnelProps) => {
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
          Quarterly expiration funnel
        </CardTitle>
        <p className="text-xs text-zinc-400">
          Active leases whose contractual end date falls in each quarter
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="tracking-wide text-zinc-300">{bucket.label}</span>
              <span className="font-medium text-zinc-50">{bucket.count}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 shadow-[0_0_12px_-2px_var(--glow-accent)]"
                style={{ width: `${(bucket.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
