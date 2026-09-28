import { Activity, DollarSign, TrendingUp, Users } from "lucide-react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { ChatPanel } from "@/components/dashboard/chat-panel"
import { SiteHeader } from "@/components/dashboard/site-header"
import { StatCard } from "@/components/dashboard/stat-card"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

const stats = [
  { label: "Total Revenue", value: "$48,231", change: "+12.4% from last month", icon: DollarSign },
  { label: "Active Users", value: "2,340", change: "+3.1% from last month", icon: Users },
  { label: "Conversion Rate", value: "4.6%", change: "+0.4% from last month", icon: TrendingUp },
  { label: "Requests / min", value: "182", change: "steady over last hour", icon: Activity },
] as const

export default function Page() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader title="Overview" description="Welcome back to your workspace" />

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          <div id="assistant" className="min-h-0 flex-1">
            <ChatPanel />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
