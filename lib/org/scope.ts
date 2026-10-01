import { isOrgRole, type OrgRole } from "@/lib/org/types"

/** True if the role may INSERT/UPDATE operational org data. Viewers cannot. */
export const canWriteWithRole = (role: OrgRole): boolean =>
  role === "owner" || role === "admin" || role === "member"

/** True if the role may rename the org, invite members, or open billing. */
export const canManageOrgWithRole = (role: OrgRole): boolean =>
  role === "owner" || role === "admin"

export const parseOrgRole = (value: string | null | undefined): OrgRole | null =>
  isOrgRole(value) ? value : null

/**
 * Picks the active org from memberships: cookie match first, otherwise the
 * earliest membership (personal workspace created on first login).
 */
export const resolveActiveMembership = <T extends { orgId: string }>(
  memberships: T[],
  cookieOrgId: string | null
): T | null => {
  if (memberships.length === 0) return null
  if (cookieOrgId) {
    const match = memberships.find((membership) => membership.orgId === cookieOrgId)
    if (match) return match
  }
  return memberships[0] ?? null
}

export const normalizeEmail = (value: string): string => value.trim().toLowerCase()
