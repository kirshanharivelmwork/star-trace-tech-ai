import Link from "next/link"
import { Settings, Shield } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      description="Account and workspace preferences"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Institutional controls
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-zinc-400">
          <Link
            href="/security"
            className="flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
          >
            <Shield className="size-4 text-zinc-400" />
            <div>
              <p className="font-medium tracking-tight text-zinc-50">
                Data room &amp; audit trail
              </p>
              <p className="text-xs text-zinc-500">
                Immutable user actions, timestamps, and resource mutations
              </p>
            </div>
          </Link>
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <Settings className="size-3.5" />
            Additional workspace preferences will land here.
          </p>
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
