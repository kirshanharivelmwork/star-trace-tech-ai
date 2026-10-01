"use client"

import { useTransition } from "react"

import { switchActiveOrg } from "@/lib/org/actions"
import type { OrgMembership } from "@/lib/org/types"

type OrgSwitcherProps = {
  orgName: string
  orgId: string
  memberships: OrgMembership[]
}

export const OrgSwitcher = ({
  orgName,
  orgId,
  memberships,
}: OrgSwitcherProps) => {
  const [isPending, startTransition] = useTransition()

  if (memberships.length <= 1) {
    return (
      <p className="truncate px-2 text-[11px] tracking-wide text-zinc-500">
        {orgName}
      </p>
    )
  }

  return (
    <label className="flex min-w-0 flex-col gap-1 px-2">
      <span className="text-[10px] tracking-widest text-zinc-500 uppercase">
        Workspace
      </span>
      <select
        className="h-9 w-full truncate rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-2 text-xs text-zinc-100"
        value={orgId}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value
          startTransition(async () => {
            await switchActiveOrg(next)
          })
        }}
      >
        {memberships.map((membership) => (
          <option key={membership.orgId} value={membership.orgId}>
            {membership.orgName}
          </option>
        ))}
      </select>
    </label>
  )
}
