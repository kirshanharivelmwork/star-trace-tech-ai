import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"

import {
  getCronDueLeaseAlerts,
  resolveCronThreshold,
  type LeaseAlert,
  type PortfolioLeaseRow,
} from "@/lib/lease/portfolio-metrics"
import { calendarDaysUntil, parseIsoDate } from "@/lib/enterprise/metrics"
import { getAppUrl, getResendFromAddress } from "@/lib/email/from"
import { createAdminClient } from "@/lib/supabase/admin"

// Cron jobs must never be statically cached/prerendered — always run live.
export const dynamic = "force-dynamic"
export const maxDuration = 60

const DASHBOARD_URL = `${getAppUrl()}/app`

const ADMIN_ROLES = new Set(["owner", "admin"])

type SendResult = { ok: true } | { ok: false; reason: string }

type DispatchKey = {
  organizationId: string
  leaseId?: string | null
  abstractId?: string | null
  alertType: string
  thresholdDays: number
}

/** Per-source tally; surfaced in the JSON response so failures are visible. */
type Tally = {
  /** Alerts with >= 1 successful email, recorded in alert_dispatches. */
  sent: number
  /** Alerts where no recipient could be emailed; NOT recorded, so retried. */
  failed: number
  /** Alerts already dispatched earlier (e.g. a second cron run today). */
  skipped: number
  emailsSent: number
  emailsFailed: number
}

const newTally = (): Tally => ({
  sent: 0,
  failed: 0,
  skipped: 0,
  emailsSent: 0,
  emailsFailed: 0,
})

/**
 * Resolves recipient emails with per-run memoisation so each organisation's
 * member list and each user's auth record is fetched at most once per cron
 * run, however many alerts they appear in (avoids N+1 getUserById calls).
 */
const createRecipientResolver = (supabaseAdmin: SupabaseClient) => {
  const userEmailCache = new Map<string, Promise<string | null>>()
  const orgAdminCache = new Map<string, Promise<string[]>>()

  const getUserEmail = (userId: string): Promise<string | null> => {
    const cached = userEmailCache.get(userId)
    if (cached) return cached

    const lookup = (async () => {
      try {
        const { data, error } =
          await supabaseAdmin.auth.admin.getUserById(userId)
        if (error || !data?.user?.email) {
          console.error(
            `[CRON] No email for user_id ${userId}:`,
            error?.message ?? "user has no email on file"
          )
          return null
        }
        return data.user.email
      } catch (lookupError) {
        console.error("[CRON] getUserById failed:", lookupError)
        return null
      }
    })()

    userEmailCache.set(userId, lookup)
    return lookup
  }

  const getOrgAdminEmails = (organizationId: string): Promise<string[]> => {
    const cached = orgAdminCache.get(organizationId)
    if (cached) return cached

    const lookup = (async () => {
      const { data, error } = await supabaseAdmin
        .from("organization_members")
        .select("user_id, role")
        .eq("org_id", organizationId)

      if (error) {
        console.error("[CRON] organization_members:", error.message)
        return []
      }

      const adminIds = (data ?? [])
        .filter((row: { role: string | null }) =>
          ADMIN_ROLES.has((row.role ?? "").toLowerCase())
        )
        .map((row: { user_id: string }) => row.user_id)

      const emails = await Promise.all(adminIds.map(getUserEmail))
      return [...new Set(emails.filter((e): e is string => Boolean(e)))]
    })()

    orgAdminCache.set(organizationId, lookup)
    return lookup
  }

  /** Org owners/admins if any resolve; otherwise the record's owner. */
  const resolveRecipients = async (params: {
    organizationId: string | null
    userId: string | null | undefined
  }): Promise<string[]> => {
    if (params.organizationId) {
      const admins = await getOrgAdminEmails(params.organizationId)
      if (admins.length > 0) return admins
    }
    if (!params.userId) return []
    const email = await getUserEmail(params.userId)
    return email ? [email] : []
  }

  return { resolveRecipients }
}

const wasDispatched = async (
  supabaseAdmin: SupabaseClient,
  key: DispatchKey
): Promise<boolean> => {
  let query = supabaseAdmin
    .from("alert_dispatches")
    .select("id", { head: true, count: "exact" })
    .eq("organization_id", key.organizationId)
    .eq("alert_type", key.alertType)
    .eq("threshold_days", key.thresholdDays)

  query = key.leaseId
    ? query.eq("lease_id", key.leaseId)
    : query.is("lease_id", null)
  query = key.abstractId
    ? query.eq("abstract_id", key.abstractId)
    : query.is("abstract_id", null)

  const { count, error } = await query
  if (error) {
    // Fail open: worst case is a duplicate email, which the unique index +
    // ON CONFLICT DO NOTHING below still prevents from being double-recorded.
    console.error("[CRON] alert_dispatches lookup:", error.message)
    return false
  }
  return (count ?? 0) > 0
}

/**
 * Records a dispatch. Idempotent: backed by the unique index on
 * (organization_id, alert_type, threshold_days, lease_id, abstract_id)
 * (NULLS NOT DISTINCT — see migration 20261005) and ON CONFLICT DO NOTHING
 * via `ignoreDuplicates`, so concurrent/repeated runs never error or
 * double-insert.
 */
const markDispatched = async (
  supabaseAdmin: SupabaseClient,
  key: DispatchKey
): Promise<boolean> => {
  const { error } = await supabaseAdmin.from("alert_dispatches").upsert(
    {
      organization_id: key.organizationId,
      lease_id: key.leaseId ?? null,
      abstract_id: key.abstractId ?? null,
      alert_type: key.alertType,
      threshold_days: key.thresholdDays,
    },
    {
      onConflict:
        "organization_id,alert_type,threshold_days,lease_id,abstract_id",
      ignoreDuplicates: true,
    }
  )
  if (error) {
    console.error("[CRON] alert_dispatches insert:", error.message)
    return false
  }
  return true
}

/**
 * Emails every recipient, then records the dispatch ONLY if at least one
 * email actually went out. If all sends fail the alert is left unrecorded
 * so a later run (within the retry grace window) tries again.
 */
const deliverAndRecord = async (params: {
  supabaseAdmin: SupabaseClient
  tally: Tally
  key: DispatchKey
  recipients: string[]
  label: string
  send: (to: string) => Promise<SendResult>
}) => {
  const { supabaseAdmin, tally, key, recipients, label, send } = params

  if (recipients.length === 0) {
    console.warn(`[CRON] No deliverable recipients for ${label}; will retry.`)
    tally.failed += 1
    return
  }

  let delivered = 0
  for (const recipient of recipients) {
    const result = await send(recipient)
    if (result.ok) {
      delivered += 1
      tally.emailsSent += 1
      continue
    }
    tally.emailsFailed += 1
  }

  if (delivered === 0) {
    console.error(
      `[CRON] All ${recipients.length} email(s) failed for ${label}.`
    )
    tally.failed += 1
    return
  }

  if (delivered < recipients.length) {
    console.warn(
      `[CRON] ${recipients.length - delivered}/${recipients.length} email(s) failed for ${label}; marking dispatched (>= 1 delivered).`
    )
  }

  tally.sent += 1
  await markDispatched(supabaseAdmin, key)
}

const sendEmail = async (
  resend: Resend,
  message: { from: string; to: string; subject: string; html: string }
): Promise<SendResult> => {
  try {
    const { error } = await resend.emails.send(message)
    if (error) {
      console.error("[CRON] Resend API error:", error.message)
      return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (error) {
    console.error("[CRON] Unexpected error sending email:", error)
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Unknown send error",
    }
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
 * Sends one lease alert to one recipient. Never throws; returns whether the
 * email was accepted by Resend so the caller can decide whether to record
 * the dispatch.
 */
const sendLeaseAlertEmail = (params: {
  resend: Resend
  from: string
  to: string
  alert: LeaseAlert
}): Promise<SendResult> => {
  const { resend, from, to, alert } = params
  return sendEmail(resend, {
    from,
    to,
    subject: `⚠️ Action Required: Lease Deadline Alert (${alert.fileName})`,
    html: buildAlertEmailHtml({
      fileName: alert.fileName,
      tenantName: alert.tenantName,
      milestoneDate: alert.date,
      daysUntil: alert.daysUntil,
      deadlineType: alert.type,
    }),
  })
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

const sendNoticeWindowEmail = (params: {
  resend: Resend
  from: string
  to: string
  tenantName: string
  propertyName: string
  targetDate: Date
  daysUntil: number
}): Promise<SendResult> => {
  const { resend, from, to } = params
  return sendEmail(resend, {
    from,
    to,
    subject: `⚠️ Action Required: Notice window (${params.tenantName})`,
    html: buildNoticeWindowEmailHtml({
      tenantName: params.tenantName,
      propertyName: params.propertyName,
      targetDate: params.targetDate,
      daysUntil: params.daysUntil,
    }),
  })
}

type CronContext = {
  supabaseAdmin: SupabaseClient
  resend: Resend
  from: string
  resolveRecipients: ReturnType<
    typeof createRecipientResolver
  >["resolveRecipients"]
  now: Date
}

const processNoticeWindows = async (
  ctx: CronContext
): Promise<{ processedWindows: number; tally: Tally }> => {
  const { supabaseAdmin, resend, from, resolveRecipients, now } = ctx
  const tally = newTally()

  const { data: windowData, error: windowError } = await supabaseAdmin
    .from("notice_windows")
    .select("id, lease_id, status, target_date")

  if (windowError) {
    console.error("[CRON] Failed to fetch notice_windows:", windowError.message)
    return { processedWindows: 0, tally }
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

  for (const window of windows) {
    const status = window.status?.trim().toLowerCase() ?? ""
    if (status && NOTICE_SKIP_STATUS.has(status)) continue

    const targetDate = parseIsoDate(window.target_date)
    if (!targetDate) continue

    const daysUntil = calendarDaysUntil(targetDate, now)
    const thresholdDays = resolveCronThreshold(daysUntil)
    if (thresholdDays === null) continue

    const lease = window.lease_id ? leaseById.get(window.lease_id) : undefined
    const property = lease?.property_id
      ? propertyById.get(lease.property_id)
      : undefined
    const userId = property?.user_id
    const organizationId = property?.organization_id

    // Dedupe is keyed on organization_id; without one we cannot guarantee
    // at-most-once delivery, so surface it as failed instead of emailing daily.
    if (!organizationId) {
      console.warn(
        `[CRON] Skipping notice window ${window.id} — property has no organization_id.`
      )
      tally.failed += 1
      continue
    }

    const key: DispatchKey = {
      organizationId,
      leaseId: window.lease_id,
      alertType: "notice_window",
      thresholdDays,
    }

    if (await wasDispatched(supabaseAdmin, key)) {
      tally.skipped += 1
      continue
    }

    const recipients = await resolveRecipients({ organizationId, userId })
    const tenantName = lease?.tenant_name?.trim() || "Unnamed tenant"
    const propertyName = property?.name?.trim() || "Unassigned asset"

    await deliverAndRecord({
      supabaseAdmin,
      tally,
      key,
      recipients,
      label: `notice window ${window.id}`,
      send: (to) =>
        sendNoticeWindowEmail({
          resend,
          from,
          to,
          tenantName,
          propertyName,
          targetDate,
          daysUntil,
        }),
    })
  }

  return { processedWindows: windows.length, tally }
}

const processLeaseAlerts = async (
  ctx: CronContext
): Promise<{ processedLeases: number; tally: Tally } | { error: string }> => {
  const { supabaseAdmin, resend, from, resolveRecipients, now } = ctx
  const tally = newTally()

  const { data, error } = await supabaseAdmin
    .from("lease_abstracts")
    .select("id, file_name, abstract_data, user_id, organization_id")

  if (error) {
    console.error("[CRON] Failed to fetch lease_abstracts:", error.message)
    return { error: "Failed to fetch lease_abstracts." }
  }

  const records = (data ?? []) as PortfolioLeaseRow[]

  // Expiration dates only (90/60/30 days out, plus the retry grace window);
  // rent-review alerts are intentionally excluded here even though the
  // in-app bell shows them.
  const alerts = getCronDueLeaseAlerts(records, now).filter(
    (alert) => alert.type === "expiration"
  )

  const recordsById = new Map(records.map((record) => [record.id, record]))

  for (const alert of alerts) {
    const record = recordsById.get(alert.recordId)
    const userId = record?.user_id
    const organizationId = record?.organization_id ?? null

    // See note in processNoticeWindows: dedupe requires an organization_id.
    if (!organizationId) {
      console.warn(
        `[CRON] Skipping alert for abstract ${alert.recordId} — record has no organization_id.`
      )
      tally.failed += 1
      continue
    }

    const key: DispatchKey = {
      organizationId,
      abstractId: alert.recordId,
      alertType: alert.type,
      thresholdDays: alert.thresholdDays,
    }

    if (await wasDispatched(supabaseAdmin, key)) {
      tally.skipped += 1
      continue
    }

    const recipients = await resolveRecipients({ organizationId, userId })

    await deliverAndRecord({
      supabaseAdmin,
      tally,
      key,
      recipients,
      label: `abstract ${alert.recordId} (${alert.type}, ${alert.thresholdDays}d)`,
      send: (to) => sendLeaseAlertEmail({ resend, from, to, alert }),
    })
  }

  return { processedLeases: records.length, tally }
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

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    console.error("[CRON] RESEND_API_KEY is not configured; refusing to run.")
    return new Response("RESEND_API_KEY is not configured on the server.", {
      status: 500,
    })
  }

  // Service-role client: intentionally bypasses RLS. This is a
  // system-level background job (there is no signed-in "caller" — it's
  // triggered by Vercel Cron), so it must see every tenant's leases, not
  // just one user's. Also used to resolve each recipient's email address.
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

  const ctx: CronContext = {
    supabaseAdmin,
    resend: new Resend(resendApiKey),
    from: getResendFromAddress(),
    resolveRecipients: createRecipientResolver(supabaseAdmin).resolveRecipients,
    now: new Date(),
  }

  const leaseResult = await processLeaseAlerts(ctx)
  if ("error" in leaseResult) {
    return new Response(leaseResult.error, { status: 500 })
  }

  const noticeResult = await processNoticeWindows(ctx)

  const { tally: leaseTally } = leaseResult
  const { tally: noticeTally } = noticeResult

  console.log(
    `[CRON] Leases: ${leaseResult.processedLeases} processed, ${leaseTally.sent} sent, ${leaseTally.failed} failed, ${leaseTally.skipped} already dispatched. ` +
      `Notice windows: ${noticeResult.processedWindows} processed, ${noticeTally.sent} sent, ${noticeTally.failed} failed, ${noticeTally.skipped} already dispatched.`
  )

  return Response.json({
    processedLeases: leaseResult.processedLeases,
    alertsSent: leaseTally.sent,
    alertsFailed: leaseTally.failed,
    alertsSkipped: leaseTally.skipped,
    processedNoticeWindows: noticeResult.processedWindows,
    noticeAlertsSent: noticeTally.sent,
    noticeAlertsFailed: noticeTally.failed,
    noticeAlertsSkipped: noticeTally.skipped,
    emailsSent: leaseTally.emailsSent + noticeTally.emailsSent,
    emailsFailed: leaseTally.emailsFailed + noticeTally.emailsFailed,
  })
}
