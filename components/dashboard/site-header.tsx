import { NotificationBell } from "@/components/dashboard/notification-bell"
import { UserMenu } from "@/components/dashboard/user-menu"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type SiteHeaderProps = {
  title: string
  description?: string
}

export const SiteHeader = ({ title, description }: SiteHeaderProps) => {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-800/60 px-4 backdrop-blur-2xl md:px-6">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5 bg-zinc-800" />
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <h1 className="truncate font-heading text-lg font-semibold tracking-tight text-zinc-50">
          {title}
        </h1>
        {description ? (
          <p className="truncate text-xs tracking-wide text-zinc-500">
            {description}
          </p>
        ) : null}
      </div>
      <Badge variant="default" className="hidden sm:inline-flex">
        Claude Sonnet 4.6
      </Badge>
      <Separator orientation="vertical" className="h-5 bg-zinc-800" />
      <NotificationBell />
      <UserMenu />
    </header>
  )
}
