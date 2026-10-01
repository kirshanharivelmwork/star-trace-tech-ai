"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

import { useUser } from "@/components/providers/user-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

const getInitials = (email: string) => email.slice(0, 2).toUpperCase()

export const UserMenu = () => {
  const router = useRouter()
  const { user, isLoading } = useUser()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    setIsSigningOut(false)
    router.push("/login")
    router.refresh()
  }

  if (isLoading) {
    return <div className="h-8 w-20 animate-pulse rounded-lg bg-muted" />
  }

  if (!user) return null

  return (
    <div className="flex items-center gap-2">
      <Avatar size="sm">
        <AvatarFallback>{getInitials(user.email ?? "?")}</AvatarFallback>
      </Avatar>
      <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline">
        {user.email}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleSignOut}
        disabled={isSigningOut}
      >
        <LogOut className="size-3.5" />
        <span className="sr-only">Sign out</span>
      </Button>
    </div>
  )
}
