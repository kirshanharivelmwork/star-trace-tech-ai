import { Settings } from "lucide-react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { Card, CardContent } from "@/components/ui/card"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

/**
 * Placeholder so the sidebar's "Settings" link is a real route instead of
 * a dead `/#settings` anchor — no settings functionality has been
 * requested/built yet. Replace this with real account/billing/notification
 * settings when that's scoped.
 */
export default function SettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader
          title="Settings"
          description="Account and workspace preferences"
        />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Settings className="size-5" />
              <p>Settings are coming soon.</p>
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
