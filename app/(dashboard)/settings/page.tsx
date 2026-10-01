import Link from "next/link"
import { Shield } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { SettingsPanels } from "@/components/settings/settings-panels"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getOrgContext } from "@/lib/org/context"
import { getOrgSubscription } from "@/lib/stripe/server"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>
}) {
  const org = await getOrgContext()
  const params = await searchParams

  return (
    <DashboardShell
      title="Settings"
      description="Account, workspace, billing, and team"
    >
      {org ? (
        <SettingsPanels
          org={org}
          isPro={(await getOrgSubscription(org.orgId, org.userId)).isPro}
          billingMissing={params.billing === "missing"}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Data room
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/security"
            className="flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 text-sm transition-colors hover:border-pink-300/40 hover:text-zinc-100"
          >
            <Shield className="size-4 text-zinc-400" />
            <div>
              <p className="font-medium tracking-tight text-zinc-50">
                Audit trail
              </p>
              <p className="text-xs text-zinc-500">
                Abstracts, expenses, invites, billing portal, accounting inputs
              </p>
            </div>
          </Link>
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
