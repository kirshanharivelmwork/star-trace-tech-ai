"use client"

import { useActionState, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

import {
  createOrganization,
  inviteOrgMember,
  openBillingPortal,
  renameOrganization,
  type OrgActionState,
} from "@/lib/org/actions"
import { backfillUnlinkedAbstractsAction } from "@/lib/lease/backfill-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import type { OrgContext } from "@/lib/org/types"

const FIELD =
  "h-11 rounded-2xl border-zinc-800/80 bg-zinc-900/60 px-3.5 text-zinc-50 shadow-2xl backdrop-blur-xl placeholder:text-zinc-500"

type SettingsPanelsProps = {
  org: OrgContext
  isPro: boolean
  billingMissing: boolean
}

export const SettingsPanels = ({
  org,
  isPro,
  billingMissing,
}: SettingsPanelsProps) => {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const [renameState, renameAction, isRenaming] = useActionState<
    OrgActionState,
    FormData
  >(renameOrganization, null)
  const [createState, createAction, isCreating] = useActionState<
    OrgActionState,
    FormData
  >(createOrganization, null)
  const [inviteState, inviteAction, isInviting] = useActionState<
    OrgActionState,
    FormData
  >(inviteOrgMember, null)
  const [backfillState, backfillAction, isBackfilling] = useActionState<
    OrgActionState,
    FormData
  >(backfillUnlinkedAbstractsAction, null)

  const handlePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 6) return
    setIsUpdatingPassword(true)
    setPasswordError(null)
    setPasswordMessage(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setIsUpdatingPassword(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setPassword("")
    setPasswordMessage("Password updated.")
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-xs tracking-wide text-zinc-500">Email</p>
            <p className="font-medium tracking-tight text-zinc-50">
              {org.email ?? "Unknown"}
            </p>
          </div>
          <form onSubmit={handlePassword} className="flex flex-col gap-2">
            <label htmlFor="new-password" className="text-xs text-zinc-400">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD}
            />
            {passwordError ? (
              <p className="text-sm text-red-300">{passwordError}</p>
            ) : null}
            {passwordMessage ? (
              <p className="text-sm text-emerald-300">{passwordMessage}</p>
            ) : null}
            <Button type="submit" disabled={isUpdatingPassword || password.length < 6}>
              {isUpdatingPassword ? "Saving…" : "Update password"}
            </Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight">
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-zinc-400">
          <p>
            Plan:{" "}
            <span className="font-medium text-zinc-50">
              {isPro ? "Pro" : "Free (2 abstracts)"}
            </span>
          </p>
          <p>Billing is per workspace, not per user.</p>
          {billingMissing ? (
            <p className="text-amber-300">
              No Stripe customer is on file yet. Upgrade from the lease
              uploader first.
            </p>
          ) : null}
          {org.canManageOrg ? (
            <form action={openBillingPortal}>
              <Button type="submit">Manage billing</Button>
            </form>
          ) : (
            <p className="text-xs text-zinc-500">
              Ask a workspace owner or admin to manage billing.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight">
            Workspace
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-zinc-400">
            Current:{" "}
            <span className="font-medium text-zinc-50">{org.orgName}</span>{" "}
            <span className="text-xs text-zinc-500">({org.role})</span>
          </p>
          {org.canManageOrg ? (
            <form action={renameAction} className="flex flex-col gap-2">
              <Input
                name="name"
                defaultValue={org.orgName}
                className={FIELD}
                required
              />
              <Button type="submit" disabled={isRenaming}>
                {isRenaming ? "Saving…" : "Rename workspace"}
              </Button>
              {renameState?.ok ? (
                <p className="text-sm text-emerald-300">{renameState.message}</p>
              ) : null}
              {renameState && !renameState.ok ? (
                <p className="text-sm text-red-300">{renameState.error}</p>
              ) : null}
            </form>
          ) : null}

          <form action={createAction} className="flex flex-col gap-2">
            <label className="text-xs text-zinc-400">Create another workspace</label>
            <Input name="name" placeholder="New workspace name" className={FIELD} />
            <Button type="submit" variant="outline" disabled={isCreating}>
              {isCreating ? "Creating…" : "Create workspace"}
            </Button>
            {createState?.ok ? (
              <p className="text-sm text-emerald-300">{createState.message}</p>
            ) : null}
            {createState && !createState.ok ? (
              <p className="text-sm text-red-300">{createState.error}</p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight">
            Team
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="text-sm text-zinc-400">
            {org.memberships.map((membership) => (
              <li key={membership.orgId} className="flex justify-between py-1">
                <span className="text-zinc-200">{membership.orgName}</span>
                <span className="text-xs tracking-wide uppercase">
                  {membership.role}
                </span>
              </li>
            ))}
          </ul>
          {org.canManageOrg ? (
            <form action={inviteAction} className="flex flex-col gap-2">
              <Input
                name="email"
                type="email"
                placeholder="colleague@firm.com"
                className={FIELD}
                required
              />
              <select
                name="role"
                defaultValue="member"
                className="h-11 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 px-3 text-sm text-zinc-50"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button type="submit" disabled={isInviting}>
                {isInviting ? "Inviting…" : "Invite by email"}
              </Button>
              {inviteState?.ok ? (
                <p className="text-sm text-emerald-300">{inviteState.message}</p>
              ) : null}
              {inviteState && !inviteState.ok ? (
                <p className="text-sm text-red-300">{inviteState.error}</p>
              ) : null}
            </form>
          ) : (
            <p className="text-xs text-zinc-500">
              Only owners and admins can invite teammates.
            </p>
          )}
        </CardContent>
      </Card>

      {org.canWrite ? (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium tracking-tight">
              Link existing abstracts
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-zinc-400">
            <p>
              Create property and lease rows for abstracts that were uploaded
              before the unified record existed. Safe to run more than once.
            </p>
            <form action={backfillAction}>
              <Button type="submit" variant="outline" disabled={isBackfilling}>
                {isBackfilling ? "Linking…" : "Backfill lease records"}
              </Button>
            </form>
            {backfillState?.ok ? (
              <p className="text-emerald-300">{backfillState.message}</p>
            ) : null}
            {backfillState && !backfillState.ok ? (
              <p className="text-red-300">{backfillState.error}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
