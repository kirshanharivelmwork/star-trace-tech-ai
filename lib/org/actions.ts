"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { writeAuditLog } from "@/lib/audit/write"
import { escapeHtml } from "@/lib/email/escape"
import { getAppUrl, getResendFromAddress } from "@/lib/email/from"
import { getOrgContext, requireManageOrg } from "@/lib/org/context"
import { normalizeEmail } from "@/lib/org/scope"
import { ACTIVE_ORG_COOKIE, type OrgRole } from "@/lib/org/types"
import { stripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"

export type OrgActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

export const switchActiveOrg = async (orgId: string): Promise<void> => {
  const context = await getOrgContext()
  if (!context) redirect("/login")

  const allowed = context.memberships.some((membership) => membership.orgId === orgId)
  if (!allowed) {
    throw new Error("You are not a member of that workspace.")
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/", "layout")
}

export const renameOrganization = async (
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> => {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { ok: false, error: "Enter a workspace name." }

  try {
    const context = await requireManageOrg()
    const supabase = await createClient()
    const { error } = await supabase
      .from("organizations")
      .update({ name })
      .eq("id", context.orgId)

    if (error) return { ok: false, error: error.message }

    revalidatePath("/settings")
    return { ok: true, message: "Workspace renamed." }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not rename workspace.",
    }
  }
}

export const createOrganization = async (
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> => {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { ok: false, error: "Enter a workspace name." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to create a workspace." }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, created_by: user.id })
    .select("id")
    .single()

  if (orgError || !org) {
    return { ok: false, error: orgError?.message ?? "Could not create workspace." }
  }

  const { error: memberError } = await supabase.from("organization_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "owner" satisfies OrgRole,
  })

  if (memberError) {
    return { ok: false, error: memberError.message }
  }

  await switchActiveOrg(org.id)
  revalidatePath("/settings")
  return { ok: true, message: "Workspace created." }
}

export const inviteOrgMember = async (
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> => {
  const email = normalizeEmail(String(formData.get("email") ?? ""))
  const roleRaw = String(formData.get("role") ?? "member")
  const role =
    roleRaw === "admin" || roleRaw === "viewer" || roleRaw === "member"
      ? roleRaw
      : "member"

  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." }
  }

  try {
    const context = await requireManageOrg()
    const supabase = await createClient()

    const { data: invite, error: inviteError } = await supabase
      .from("organization_invites")
      .upsert(
        {
          org_id: context.orgId,
          email,
          role,
          invited_by: context.userId,
        },
        { onConflict: "org_id,email" }
      )
      .select("id")
      .single()

    if (inviteError) {
      return { ok: false, error: inviteError.message }
    }

    let addedExisting = false
    try {
      const admin = createAdminClient()
      const { data: existingId, error: lookupError } = await admin.rpc(
        "lookup_user_id_by_email",
        { p_email: email }
      )

      if (!lookupError && typeof existingId === "string" && existingId) {
        const { error: memberError } = await admin
          .from("organization_members")
          .upsert({
            org_id: context.orgId,
            user_id: existingId,
            role,
          })

        if (!memberError) {
          addedExisting = true
          await admin.from("organization_invites").delete().eq("id", invite.id)
        }
      }
    } catch (lookupError) {
      console.error("[org] invite lookup:", lookupError)
    }

    await writeAuditLog({
      supabase,
      userId: context.userId,
      organizationId: context.orgId,
      action: "invite",
      resourceType: "organization_invites",
      details: { email, role, added_existing: addedExisting },
    })

    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: getResendFromAddress(),
          to: email,
          subject: `You're invited to ${context.orgName} on StarFlow`,
          // orgName is user-controlled: escape it before putting it in HTML.
          html: `<p>You've been invited to join <strong>${escapeHtml(context.orgName)}</strong> as a ${role}.</p>
<p>Sign up or sign in with this email at <a href="${getAppUrl()}/login">${getAppUrl()}/login</a> to accept.</p>`,
        })
      } catch (emailError) {
        console.error("[org] invite email:", emailError)
      }
    }

    revalidatePath("/settings")
    return {
      ok: true,
      message: addedExisting
        ? `${email} was added to the workspace.`
        : `Invite stored for ${email}. They must sign up with that email to join.`,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not send invite.",
    }
  }
}

export const openBillingPortal = async (): Promise<void> => {
  const context = await requireManageOrg()
  const supabase = await createClient()

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", context.orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>()

  const customerId = subscription?.stripe_customer_id
  if (!customerId) {
    redirect("/settings?billing=missing")
  }

  await writeAuditLog({
    supabase,
    userId: context.userId,
    organizationId: context.orgId,
    action: "open",
    resourceType: "billing_portal",
    details: { stripe_customer_id: customerId },
  })

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppUrl()}/settings`,
  })

  if (!session.url) {
    redirect("/settings?billing=error")
  }

  redirect(session.url)
}
