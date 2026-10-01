import type { ReactNode } from "react"

import { AmbientOrbs } from "@/components/dashboard/ambient-orbs"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { OrgProvider } from "@/components/providers/org-provider"
import { getOrgContext } from "@/lib/org/context"

type DashboardShellProps = {
  title: string
  description?: string
  children: ReactNode
}

export const DashboardShell = async ({
  title,
  description,
  children,
}: DashboardShellProps) => {
  const org = await getOrgContext()

  return (
    <OrgProvider value={org}>
      <SidebarProvider className="relative">
        <AmbientOrbs />
        <AppSidebar
          orgName={org?.orgName ?? "StarFlow"}
          orgId={org?.orgId ?? ""}
          memberships={org?.memberships ?? []}
        />
        <SidebarInset>
          <SiteHeader title={title} description={description} />
          <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </OrgProvider>
  )
}
