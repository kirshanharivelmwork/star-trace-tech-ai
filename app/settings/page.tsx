import { Settings } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Card, CardContent } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      description="Account and workspace preferences"
    >
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Settings className="size-5 text-violet-300" />
          <p>Settings are coming soon.</p>
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
