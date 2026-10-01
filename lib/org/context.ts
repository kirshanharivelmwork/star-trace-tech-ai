import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  canManageOrgWithRole,
  canWriteWithRole,
  parseOrgRole,
  resolveActiveMembership,
} from "@/lib/org/scope"
import {
  ACTIVE_ORG_COOKIE,
  type OrgContext,
  type OrgMembership,
  type OrgRole,
} from "@/lib/org/types"

type MembershipRow = {
  org_id: string
  role: string
  organizations: { id: string; name: string } | { id: string; name: string }[] | null
}

const asOrgName = (
  organizations: MembershipRow["organizations"]
): { id: string; name: string } | null => {
  if (!organizations) return null
  return Array.isArray(organizations) ? (organizations[0] ?? null) : organizations
}

const loadMemberships = async (): Promise<OrgMembership[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("organization_members")
    .select("org_id, role, organizations ( id, name )")
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[org] memberships:", error.message)
    return []
  }

  return ((data ?? []) as MembershipRow[])
    .map((row) => {
      const org = asOrgName(row.organizations)
      const role = parseOrgRole(row.role)
      if (!org || !role) return null
      return {
        orgId: org.id,
        orgName: org.name,
        role,
      } satisfies OrgMembership
    })
    .filter((row): row is OrgMembership => row != null)
}

const bootstrapOrg = async (): Promise<void> => {
  const supabase = await createClient()
  const { error: inviteError } = await supabase.rpc("accept_pending_org_invites")
  if (inviteError) {
    console.error("[org] accept_pending_org_invites:", inviteError.message)
  }

  const { error } = await supabase.rpc("ensure_personal_organization")
  if (!error) return

  console.error("[org] ensure_personal_organization:", error.message)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: "Personal workspace", created_by: user.id })
    .select("id")
    .single()

  if (orgError || !org) {
    console.error("[org] fallback organization insert:", orgError?.message)
    return
  }

  const { error: memberError } = await supabase.from("organization_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "owner",
  })

  if (memberError) {
    console.error("[org] fallback membership insert:", memberError.message)
  }
}

export const getOrgContext = async (): Promise<OrgContext | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  let memberships = await loadMemberships()
  if (memberships.length === 0) {
    await bootstrapOrg()
    memberships = await loadMemberships()
  } else {
    await supabase.rpc("accept_pending_org_invites")
    memberships = await loadMemberships()
  }

  if (memberships.length === 0) return null

  const cookieStore = await cookies()
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null
  const active = resolveActiveMembership(memberships, cookieOrgId)
  if (!active) return null

  const role: OrgRole = active.role

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: active.orgId,
    orgName: active.orgName,
    role,
    memberships,
    canWrite: canWriteWithRole(role),
    canManageOrg: canManageOrgWithRole(role),
  }
}

export const requireOrgContext = async (): Promise<OrgContext> => {
  const context = await getOrgContext()
  if (context) return context

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  throw new Error(
    "Could not load a workspace. Paste supabase/migrations/20261001_starflow_institutional.sql into the Supabase SQL editor, then refresh."
  )
}

export const requireWritableOrg = async (): Promise<OrgContext> => {
  const context = await requireOrgContext()
  if (!context.canWrite) {
    throw new Error("You have view-only access to this workspace.")
  }
  return context
}

export const requireManageOrg = async (): Promise<OrgContext> => {
  const context = await requireOrgContext()
  if (!context.canManageOrg) {
    throw new Error("Only owners and admins can manage this workspace.")
  }
  return context
}
