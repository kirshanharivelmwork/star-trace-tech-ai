import type { ReactNode } from "react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

type DashboardShellProps = {
  title: string
  description?: string
  children: ReactNode
}

/**
 * Shared chrome for every dashboard route so Overview / Analytics /
 * Customers / Settings all inherit the same inset glass layout instead of
 * each page re-declaring SidebarProvider + header + padded main.
 */
export const DashboardShell = ({
  title,
  description,
  children,
}: DashboardShellProps) => {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader title={title} description={description} />
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
