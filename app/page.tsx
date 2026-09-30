import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { ChatPanel } from "@/components/dashboard/chat-panel"
import { LeaseWorkspace } from "@/components/dashboard/lease-workspace"
import { PortfolioAnalytics } from "@/components/dashboard/portfolio-analytics"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function Page() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader title="Overview" description="Welcome back to your workspace" />

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <PortfolioAnalytics />

          <LeaseWorkspace />

          <div id="assistant" className="min-h-0 flex-1">
            <ChatPanel />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
