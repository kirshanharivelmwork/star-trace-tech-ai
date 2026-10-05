"use client"

import { useEffect, useState } from "react"
import { FileText, LogIn } from "lucide-react"

import { useOrg } from "@/components/providers/org-provider"
import { useUser } from "@/components/providers/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import type { LeaseAbstractRecord } from "@/app/api/lease/schema"

type AbstractHistoryProps = {
  /** Bump this value (e.g. a counter) to trigger a refetch. */
  refreshKey: number
  selectedId: string | null
  onSelect: (record: LeaseAbstractRecord) => void
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

export const AbstractHistory = ({
  refreshKey,
  selectedId,
  onSelect,
}: AbstractHistoryProps) => {
  const { user, isLoading: isUserLoading } = useUser()
  const org = useOrg()
  const [records, setRecords] = useState<LeaseAbstractRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canFetch = Boolean(user && org?.orgId)
  const visibleRecords = canFetch ? records : []
  const visibleError = canFetch ? error : null

  useEffect(() => {
    // Wait for the auth state to resolve before deciding whether to fetch —
    // avoids a flash of "no leases" for a user who is actually signed in.
    if (isUserLoading) return

    // Signed-out / org-less state is derived at render time (see `canFetch`).
    if (!user || !org?.orgId) return

    let isCancelled = false

    const fetchHistory = async () => {
      setIsLoading(true)
      setError(null)

      const supabase = createClient()
      const { data, error: fetchError } = await supabase
        .from("lease_abstracts")
        .select("id, user_id, organization_id, lease_id, file_name, storage_path, abstract_data, created_at")
        .eq("organization_id", org.orgId)
        .order("created_at", { ascending: false })

      if (isCancelled) return

      if (fetchError) {
        console.error("[AbstractHistory] Failed to fetch history:", fetchError.message)
        setError(fetchError.message)
      } else {
        setRecords((data ?? []) as LeaseAbstractRecord[])
      }

      setIsLoading(false)
    }

    fetchHistory()

    return () => {
      isCancelled = true
    }
  }, [user, isUserLoading, org?.orgId, refreshKey])

  return (
    <Card className="flex h-full min-h-[32rem] flex-col">
      <CardHeader>
        <CardTitle>Past Abstracts</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden px-0">
        <ScrollArea className="h-full px-4">
          {isUserLoading || (canFetch && isLoading) ? (
            <div className="flex flex-col gap-3 pb-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : !user ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <LogIn className="size-5" />
              <p>Sign in to view your lease history.</p>
            </div>
          ) : visibleError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {visibleError}
            </div>
          ) : visibleRecords.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <FileText className="size-5" />
              <p>No leases analyzed yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pb-4">
              {visibleRecords.map((record) => {
                const isSelected = record.id === selectedId

                return (
                  <Button
                    key={record.id}
                    type="button"
                    variant={isSelected ? "secondary" : "outline"}
                    onClick={() => onSelect(record)}
                    className={
                      isSelected
                        ? "h-auto w-full flex-col items-start gap-1 whitespace-normal rounded-2xl border-pink-300/40 px-3 py-2 text-left shadow-[0_0_20px_-10px_var(--glow-primary)]"
                        : "h-auto w-full flex-col items-start gap-1 whitespace-normal rounded-2xl px-3 py-2 text-left"
                    }
                  >
                    <span className="w-full truncate text-sm font-medium text-foreground">
                      {record.file_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(record.created_at)}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {record.abstract_data?.tenantName ?? "Unknown tenant"} ·{" "}
                      {record.abstract_data?.landlordName ?? "Unknown landlord"}
                    </span>
                  </Button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
