import { Landmark } from "lucide-react"

import { CamBoard } from "@/components/dashboard/cam-board"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { FinanceTabs } from "@/components/dashboard/finance-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { fetchCamSnapshot } from "@/lib/enterprise/queries"
import { createClient } from "@/lib/supabase/server"

const EmptyState = ({ message }: { message: string }) => (
  <Card>
    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-400">
      <Landmark className="size-5 text-violet-300" />
      <p>{message}</p>
    </CardContent>
  </Card>
)

const CamContent = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <EmptyState message="Sign in to reconcile CAM and operating expenses." />
  }

  const snapshot = await fetchCamSnapshot(user.id)
  return <CamBoard snapshot={snapshot} />
}

export default function CamPage() {
  return (
    <DashboardShell
      title="Finances"
      description="CAM reconciliation · prorated tenant allocations"
    >
      <FinanceTabs active="cam" />
      <CamContent />
    </DashboardShell>
  )
}
