export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const

export type OrgRole = (typeof ORG_ROLES)[number]

export type OrgMembership = {
  orgId: string
  orgName: string
  role: OrgRole
}

export type OrgContext = {
  userId: string
  email: string | null
  orgId: string
  orgName: string
  role: OrgRole
  memberships: OrgMembership[]
  canWrite: boolean
  canManageOrg: boolean
}

export const ACTIVE_ORG_COOKIE = "starflow_org_id"

export const isOrgRole = (value: string | null | undefined): value is OrgRole =>
  Boolean(value && (ORG_ROLES as readonly string[]).includes(value))
