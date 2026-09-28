import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type SiteHeaderProps = {
  title: string
  description?: string
}

export const SiteHeader = ({ title, description }: SiteHeaderProps) => {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <h1 className="truncate font-heading text-sm font-medium">{title}</h1>
        {description ? (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Badge variant="secondary" className="hidden sm:inline-flex">
        Claude 3.5 Sonnet
      </Badge>
    </header>
  )
}
