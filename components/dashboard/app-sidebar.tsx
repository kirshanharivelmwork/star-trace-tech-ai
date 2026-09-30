"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Home,
  Landmark,
  MessageSquare,
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

const navItems = [
  { title: "Overview", href: "/", icon: Home },
  // Same-page anchor, not a route — app/page.tsx renders
  // <div id="assistant"> around the chat panel, so this actually works.
  { title: "Assistant", href: "/#assistant", icon: MessageSquare },
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Finances", href: "/finances", icon: Landmark },
  { title: "Data room", href: "/security", icon: Shield },
] as const

const footerItems = [{ title: "Settings", href: "/settings", icon: Settings }] as const

export const AppSidebar = () => {
  const pathname = usePathname()

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    if (href.startsWith("/#")) return pathname === "/"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200 shadow-[0_0_18px_-4px_var(--glow-primary)]">
                <Sparkles className="size-3.5" />
              </span>
              <span className="font-heading text-base font-medium tracking-tight">
                StarFlow
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

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
