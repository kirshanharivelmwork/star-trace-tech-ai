"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Home,
  Landmark,
  MessageSquare,
  Radar,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { OrgSwitcher } from "@/components/dashboard/org-switcher"
import type { OrgMembership } from "@/lib/org/types"

const navItems = [
  { title: "Overview", href: "/app", icon: Home },
  { title: "Enterprise", href: "/enterprise", icon: Radar },
  { title: "Assistant", href: "/app#assistant", icon: MessageSquare },
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Finances", href: "/finances", icon: Landmark },
  { title: "Data room", href: "/security", icon: Shield },
] as const

const footerItems = [{ title: "Settings", href: "/settings", icon: Settings }] as const

type AppSidebarProps = {
  orgName: string
  orgId: string
  memberships: OrgMembership[]
}

export const AppSidebar = ({ orgName, orgId, memberships }: AppSidebarProps) => {
  const pathname = usePathname()

  const isItemActive = (href: string) => {
    if (href === "/app") return pathname === "/app"
    if (href.startsWith("/app#")) return pathname === "/app"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/app" />}>
              <span className="icon-well size-8">
                <Sparkles className="size-3.5" />
              </span>
              <span className="font-heading text-base font-semibold tracking-tight">
                StarFlow
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
        <OrgSwitcher orgName={orgName} orgId={orgId} memberships={memberships} />
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isItemActive(item.href)}
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {footerItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={isItemActive(item.href)}
                tooltip={item.title}
                render={<Link href={item.href} />}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
