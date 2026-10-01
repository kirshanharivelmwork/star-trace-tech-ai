import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"

import {
  getExactThresholdLeaseAlerts,
  CRON_ALERT_THRESHOLDS_DAYS,
  type LeaseAlert,
  type PortfolioLeaseRow,
} from "@/lib/lease/portfolio-metrics"
import {
  calendarDaysUntil,
  parseIsoDate,
} from "@/lib/enterprise/metrics"
import { getAppUrl, getResendFromAddress } from "@/lib/email/from"
import { createAdminClient } from "@/lib/supabase/admin"

// Cron jobs must never be statically cached/prerendered — always run live.
export const dynamic = "force-dynamic"
export const maxDuration = 60

// `Resend` accepts an undefined key without throwing at construction time;
// the actual request-time call inside sendLeaseAlertEmail's try/catch is
// what fails loudly (and is logged, not thrown) if RESEND_API_KEY is unset.
const resend = new Resend(process.env.RESEND_API_KEY)

const DASHBOARD_URL = `${getAppUrl()}/app`
const FROM_ADDRESS = getResendFromAddress()

const ADMIN_ROLES = new Set(["owner", "admin"])

const resolveOrgAdminEmails = async (
  supabaseAdmin: SupabaseClient,
  organizationId: string | null | undefined
): Promise<string[]> => {
  if (!organizationId) return []

  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("user_id, role")
    .eq("org_id", organizationId)

  if (error) {
    console.error("[CRON] organization_members:", error.message)
    return []
  }

  const userIds = (data ?? [])
    .filter((row: { role: string | null }) =>
      ADMIN_ROLES.has((row.role ?? "").toLowerCase())
    )
    .map((row: { user_id: string }) => row.user_id)

  const emails: string[] = []
  for (const userId of userIds) {
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (userData?.user?.email) emails.push(userData.user.email)
    } catch (lookupError) {
      console.error("[CRON] getUserById failed:", lookupError)
    }
  }
  return [...new Set(emails)]
}

const wasDispatched = async (
  supabaseAdmin: SupabaseClient,
  params: {
    organizationId: string | null
    leaseId?: string | null
    abstractId?: string | null
    alertType: string
    thresholdDays: number
  }
): Promise<boolean> => {
  if (!params.organizationId) return false
  let query = supabaseAdmin
    .from("alert_dispatches")
    .select("id", { head: true, count: "exact" })
    .eq("organization_id", params.organizationId)
    .eq("alert_type", params.alertType)
    .eq("threshold_days", params.thresholdDays)

  if (params.leaseId) query = query.eq("lease_id", params.leaseId)
  if (params.abstractId) query = query.eq("abstract_id", params.abstractId)

  const { count, error } = await query
  if (error) {
    console.error("[CRON] alert_dispatches lookup:", error.message)
    return false
  }
  return (count ?? 0) > 0
}

const markDispatched = async (
  supabaseAdmin: SupabaseClient,
  params: {
    organizationId: string | null
    leaseId?: string | null
    abstractId?: string | null
    alertType: string
    thresholdDays: number
  }
) => {
  if (!params.organizationId) return
  const { error } = await supabaseAdmin.from("alert_dispatches").insert({
    organization_id: params.organizationId,
    lease_id: params.leaseId ?? null,
    abstract_id: params.abstractId ?? null,
    alert_type: params.alertType,
    threshold_days: params.thresholdDays,
  })
  if (error) {
    console.error("[CRON] alert_dispatches insert:", error.message)
  }
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const DEADLINE_LABELS: Record<LeaseAlert["type"], string> = {
  expiration: "Lease Expiration",
  rent_review: "Rent Review",
}

/**
 * Clean, dark-accented HTML email matching the dashboard's dark-mode
 * palette. Every dynamic value is HTML-escaped since it ultimately
 * originates from a user-uploaded file name or Claude's free-text
 * extraction of the lease PDF, not a trusted internal source.
 */
const buildAlertEmailHtml = (params: {
  fileName: string
  tenantName: string | null
  milestoneDate: Date
  daysUntil: number
  deadlineType: LeaseAlert["type"]
}) => {
  const deadlineLabel = DEADLINE_LABELS[params.deadlineType]
  const formattedDate = params.milestoneDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const daysLabel = `${params.daysUntil} day${params.daysUntil === 1 ? "" : "s"}`

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
      <div style="border-radius:12px;border:1px solid #27272a;background-color:#18181b;padding:32px 24px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:rgba(239,68,68,0.15);color:#f87171;font-size:12px;font-weight:600;letter-spacing:0.02em;">
          ⚠️ ${escapeHtml(deadlineLabel.toUpperCase())} ALERT
        </span>
        <h1 style="margin:16px 0 4px;color:#fafafa;font-size:20px;font-weight:600;line-height:1.3;">
          ${daysLabel} until ${escapeHtml(deadlineLabel.toLowerCase())}
        </h1>
        <p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;">
          ${escapeHtml(formattedDate)}
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr>
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Lease file</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${escapeHtml(params.fileName)}</td>
          </tr>
          <tr style="border-top:1px solid #27272a;">
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Tenant</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${escapeHtml(params.tenantName ?? "Not specified")}</td>
          </tr>
          <tr style="border-top:1px solid #27272a;">
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Deadline type</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${escapeHtml(deadlineLabel)}</td>
          </tr>
          <tr style="border-top:1px solid #27272a;">
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Days remaining</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${daysLabel}</td>
          </tr>
        </table>
        <a
          href="${DASHBOARD_URL}"
          style="display:block;box-sizing:border-box;text-align:center;padding:10px 16px;border-radius:8px;background-color:#fafafa;color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none;"
        >
          View in StarFlow →
        </a>
      </div>
      <p style="margin:16px 0 0;text-align:center;color:#52525b;font-size:11px;">
        Automated lifecycle alert from StarFlow.
      </p>
    </div>
  </body>
</html>`
}

/**
 * Looks up the recipient's email via the service-role Supabase Admin API
 * and sends the alert through Resend. Wrapped in try/catch by the caller's
 * expectations — this function itself also never throws: a failure here
 * (missing user, missing email, or a Resend API error) is logged and
 * swallowed so one bad lease/user never aborts the rest of the daily run.
 */
const sendLeaseAlertEmail = async (params: {
  userId: string
  overrideEmail?: string
  alert: LeaseAlert
  supabaseAdmin: SupabaseClient
}) => {
  const { userId, alert, supabaseAdmin, overrideEmail } = params

  try {
    let recipientEmail = overrideEmail
    if (!recipientEmail) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)

      if (error || !data?.user?.email) {
        console.error(
          `[CRON] Skipping email for user_id ${userId} — could not resolve an email address:`,
          error?.message ?? "user has no email on file"
        )
        return
      }
      recipientEmail = data.user.email
    }

    console.log(
      `[CRON] Sending email to user_id: ${userId} (${recipientEmail}) — Warning, lease "${alert.fileName}" ${alert.message} (${alert.daysUntil} day(s) away)`
    )

    const { error: sendError } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipientEmail,
      subject: `⚠️ Action Required: Lease Deadline Alert (${alert.fileName})`,
      html: buildAlertEmailHtml({
        fileName: alert.fileName,
        tenantName: alert.tenantName,
        milestoneDate: alert.date,
        daysUntil: alert.daysUntil,
        deadlineType: alert.type,
      }),
    })

    if (sendError) {
      console.error(
        `[CRON] Resend API error sending to ${recipientEmail}:`,
        sendError.message
      )
    }
  } catch (error) {
    console.error(
      `[CRON] Unexpected error sending lease alert email for user_id ${userId}:`,
      error
    )
  }
}

type NoticeWindowCronRow = {
  id: string
  lease_id: string | null
  status: string | null
  target_date: string | null
}

type LeaseCronRow = {
  id: string
  property_id: string | null
  tenant_name: string | null
}

type PropertyCronRow = {
  id: string
  user_id: string | null
  organization_id: string | null
  name: string | null
}

const NOTICE_SKIP_STATUS = new Set([
  "closed",
  "cancelled",
  "canceled",
  "dismissed",
  "expired",
])

const buildNoticeWindowEmailHtml = (params: {
  tenantName: string
  propertyName: string
  targetDate: Date
  daysUntil: number
}) => {
  const formattedDate = params.targetDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const daysLabel = `${params.daysUntil} day${params.daysUntil === 1 ? "" : "s"}`

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
      <div style="border-radius:12px;border:1px solid #27272a;background-color:#18181b;padding:32px 24px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:rgba(239,68,68,0.15);color:#f87171;font-size:12px;font-weight:600;letter-spacing:0.02em;">
          ⚠️ NOTICE WINDOW ALERT
        </span>
        <h1 style="margin:16px 0 4px;color:#fafafa;font-size:20px;font-weight:600;line-height:1.3;">
          ${daysLabel} until notice deadline
        </h1>
        <p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;">
          ${escapeHtml(formattedDate)}
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr>
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Tenant</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${escapeHtml(params.tenantName)}</td>
          </tr>
          <tr style="border-top:1px solid #27272a;">
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Asset</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${escapeHtml(params.propertyName)}</td>
          </tr>
          <tr style="border-top:1px solid #27272a;">
            <td style="padding:8px 0;color:#71717a;font-size:12px;">Days remaining</td>
            <td style="padding:8px 0;color:#fafafa;font-size:13px;text-align:right;">${daysLabel}</td>
          </tr>
        </table>
        <a
          href="${DASHBOARD_URL}"
          style="display:block;box-sizing:border-box;text-align:center;padding:10px 16px;border-radius:8px;background-color:#fafafa;color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none;"
        >
          View in StarFlow →
        </a>
      </div>
      <p style="margin:16px 0 0;text-align:center;color:#52525b;font-size:11px;">
        Automated notice-window alert from StarFlow.
      </p>
    </div>
  </body>
</html>`
}

const sendNoticeWindowEmail = async (params: {
  userId: string
  overrideEmail?: string
  tenantName: string
  propertyName: string
  targetDate: Date
  daysUntil: number
  supabaseAdmin: SupabaseClient
}) => {
  const { userId, supabaseAdmin, overrideEmail } = params

  try {
    let recipientEmail = overrideEmail
    if (!recipientEmail) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)

      if (error || !data?.user?.email) {
        console.error(
          `[CRON] Skipping notice email for user_id ${userId} — could not resolve an email address:`,
          error?.message ?? "user has no email on file"
        )
        return
      }
      recipientEmail = data.user.email
    }

    const { error: sendError } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipientEmail,
      subject: `⚠️ Action Required: Notice window (${params.tenantName})`,
      html: buildNoticeWindowEmailHtml({
        tenantName: params.tenantName,
        propertyName: params.propertyName,
        targetDate: params.targetDate,
        daysUntil: params.daysUntil,
      }),
    })

    if (sendError) {
      console.error(
        `[CRON] Resend API error sending notice window to ${recipientEmail}:`,
        sendError.message
      )
    }
  } catch (error) {
    console.error(
      `[CRON] Unexpected error sending notice window email for user_id ${userId}:`,
      error
    )
  }
}

const processNoticeWindows = async (
  supabaseAdmin: SupabaseClient,
  now: Date = new Date()
): Promise<{ processedWindows: number; noticeAlertsSent: number }> => {
  const { data: windowData, error: windowError } = await supabaseAdmin
    .from("notice_windows")
    .select("id, lease_id, status, target_date")

  if (windowError) {
    console.error("[CRON] Failed to fetch notice_windows:", windowError.message)
    return { processedWindows: 0, noticeAlertsSent: 0 }
  }

  const windows = (windowData ?? []) as NoticeWindowCronRow[]
  const leaseIds = [
    ...new Set(
      windows
        .map((window) => window.lease_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]

  let leases: LeaseCronRow[] = []
  if (leaseIds.length > 0) {
    const { data: leaseData, error: leaseError } = await supabaseAdmin
      .from("leases")
      .select("id, property_id, tenant_name")
      .in("id", leaseIds)

    if (leaseError) {
      console.error(
        "[CRON] Failed to fetch leases for notice windows:",
        leaseError.message
      )
    } else {
      leases = (leaseData ?? []) as LeaseCronRow[]
    }
  }

  const propertyIds = [
    ...new Set(
      leases
        .map((lease) => lease.property_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]

  let properties: PropertyCronRow[] = []
  if (propertyIds.length > 0) {
    const { data: propertyData, error: propertyError } = await supabaseAdmin
      .from("properties")
      .select("id, user_id, organization_id, name")
      .in("id", propertyIds)

    if (propertyError) {
      console.error(
        "[CRON] Failed to fetch properties for notice windows:",
        propertyError.message
      )
    } else {
      properties = (propertyData ?? []) as PropertyCronRow[]
    }
  }

  const leaseById = new Map(leases.map((lease) => [lease.id, lease]))
  const propertyById = new Map(
    properties.map((property) => [property.id, property])
  )
  const thresholds = new Set<number>(CRON_ALERT_THRESHOLDS_DAYS)

  let noticeAlertsSent = 0

  for (const window of windows) {
    const status = window.status?.trim().toLowerCase() ?? ""
    if (status && NOTICE_SKIP_STATUS.has(status)) continue

    const targetDate = parseIsoDate(window.target_date)
    if (!targetDate) continue

    const daysUntil = calendarDaysUntil(targetDate, now)
    if (!thresholds.has(daysUntil)) continue

    const lease = window.lease_id ? leaseById.get(window.lease_id) : undefined
    const property = lease?.property_id
      ? propertyById.get(lease.property_id)
      : undefined
    const userId = property?.user_id
    const organizationId = property?.organization_id

    if (!userId && !organizationId) {
      console.warn(
        `[CRON] Skipping notice window ${window.id} — could not resolve property owner.`
      )
      continue
    }

    if (
      await wasDispatched(supabaseAdmin, {
        organizationId: organizationId ?? null,
        leaseId: window.lease_id,
        alertType: "notice_window",
        thresholdDays: daysUntil,
      })
    ) {
      continue
    }

    const adminEmails = await resolveOrgAdminEmails(supabaseAdmin, organizationId)
    const recipients = adminEmails.length > 0 ? adminEmails : null

    if (recipients) {
      for (const email of recipients) {
        await sendNoticeWindowEmail({
          userId: userId ?? "org",
          overrideEmail: email,
          tenantName: lease?.tenant_name?.trim() || "Unnamed tenant",
          propertyName: property?.name?.trim() || "Unassigned asset",
          targetDate,
          daysUntil,
          supabaseAdmin,
        })
      }
    } else if (userId) {
      await sendNoticeWindowEmail({
        userId,
        tenantName: lease?.tenant_name?.trim() || "Unnamed tenant",
        propertyName: property?.name?.trim() || "Unassigned asset",
        targetDate,
        daysUntil,
        supabaseAdmin,
      })
    }

    await markDispatched(supabaseAdmin, {
      organizationId: organizationId ?? null,
      leaseId: window.lease_id,
      alertType: "notice_window",
      thresholdDays: daysUntil,
    })
    noticeAlertsSent += 1
  }

  return { processedWindows: windows.length, noticeAlertsSent }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET is not configured; refusing to run.")
    return new Response("CRON_SECRET is not configured on the server.", {
      status: 500,
    })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn(
      "[CRON] Rejected request with a missing or invalid Authorization header."
    )
    return new Response("Unauthorized", { status: 401 })
  }

  // Service-role client: intentionally bypasses RLS. This is a
  // system-level background job (there is no signed-in "caller" — it's
  // triggered by Vercel Cron), so it must see every tenant's leases, not
  // just one user's. Also used below via `.auth.admin.getUserById` to
  // resolve each recipient's email address.
  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = createAdminClient()
  } catch (error) {
    console.error("[CRON]", error instanceof Error ? error.message : error)
    return new Response(
      "Server is missing Supabase service role configuration.",
      { status: 500 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from("lease_abstracts")
    .select("id, file_name, abstract_data, user_id, organization_id")

  if (error) {
    console.error("[CRON] Failed to fetch lease_abstracts:", error.message)
    return new Response("Failed to fetch lease_abstracts.", { status: 500 })
  }

  const records = (data ?? []) as PortfolioLeaseRow[]

  // Spec calls out expiration dates specifically (exactly 90/60/30 days
  // out); rent-review alerts are intentionally excluded here even though
  // getExactThresholdLeaseAlerts supports them, so the in-app bell (which
  // does show rent-review alerts) and this cron job can each surface a
  // slightly different, deliberately-scoped set.
  const alerts = getExactThresholdLeaseAlerts(records).filter(
    (alert) => alert.type === "expiration"
  )

  const recordsById = new Map(records.map((record) => [record.id, record]))

  let sentCount = 0
  for (const alert of alerts) {
    const record = recordsById.get(alert.recordId)
    const userId = record?.user_id
    const organizationId = record?.organization_id ?? null

    if (!userId && !organizationId) {
      console.warn(
        `[CRON] Skipping alert for "${alert.fileName}" — record has no user_id or org.`
      )
      continue
    }

    if (
      await wasDispatched(supabaseAdmin, {
        organizationId,
        abstractId: alert.recordId,
        alertType: alert.type,
        thresholdDays: alert.daysUntil,
      })
    ) {
      continue
    }

    const adminEmails = await resolveOrgAdminEmails(supabaseAdmin, organizationId)
    if (adminEmails.length > 0) {
      for (const email of adminEmails) {
        await sendLeaseAlertEmail({
          userId: userId ?? "org",
          overrideEmail: email,
          alert,
          supabaseAdmin,
        })
      }
    } else if (userId) {
      await sendLeaseAlertEmail({ userId, alert, supabaseAdmin })
    }

    await markDispatched(supabaseAdmin, {
      organizationId,
      abstractId: alert.recordId,
      alertType: alert.type,
      thresholdDays: alert.daysUntil,
    })
    sentCount += 1
  }

  console.log(
    `[CRON] Processed ${records.length} lease(s); attempted ${sentCount} abstract alert(s).`
  )

  const noticeResult = await processNoticeWindows(supabaseAdmin)
  console.log(
    `[CRON] Processed ${noticeResult.processedWindows} notice window(s); attempted ${noticeResult.noticeAlertsSent} notice alert(s).`
  )

  return Response.json({
    processedLeases: records.length,
    alertsSent: sentCount,
    processedNoticeWindows: noticeResult.processedWindows,
    noticeAlertsSent: noticeResult.noticeAlertsSent,
  })
}
