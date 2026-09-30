import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ChatPanel } from "@/components/dashboard/chat-panel"
import { LeaseWorkspace } from "@/components/dashboard/lease-workspace"
import { NoticeWindowAlerts } from "@/components/dashboard/notice-window-alerts"
import { PortfolioAnalytics } from "@/components/dashboard/portfolio-analytics"

export default function Page() {
  return (
    <DashboardShell
      title="Overview"
      description="Welcome back to your workspace"
    >
      <NoticeWindowAlerts />
      <PortfolioAnalytics />
      <LeaseWorkspace />
      <div id="assistant" className="min-h-0 flex-1">
        <ChatPanel />
      </div>
    </DashboardShell>
  )
}
