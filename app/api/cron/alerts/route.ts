import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"

import {
  getExactThresholdLeaseAlerts,
  type LeaseAlert,
  type PortfolioLeaseRow,
} from "@/lib/lease/portfolio-metrics"
import { createAdminClient } from "@/lib/supabase/admin"

// Cron jobs must never be statically cached/prerendered — always run live.
export const dynamic = "force-dynamic"
export const maxDuration = 60

// `Resend` accepts an undefined key without throwing at construction time;
// the actual request-time call inside sendLeaseAlertEmail's try/catch is
// what fails loudly (and is logged, not thrown) if RESEND_API_KEY is unset.
const resend = new Resend(process.env.RESEND_API_KEY)

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

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
  alert: LeaseAlert
  supabaseAdmin: SupabaseClient
}) => {
  const { userId, alert, supabaseAdmin } = params

  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)

    if (error || !data?.user?.email) {
      console.error(
        `[CRON] Skipping email for user_id ${userId} — could not resolve an email address:`,
        error?.message ?? "user has no email on file"
      )
      return
    }

    const recipientEmail = data.user.email

    console.log(
      `[CRON] Sending email to user_id: ${userId} (${recipientEmail}) — Warning, lease "${alert.fileName}" ${alert.message} (${alert.daysUntil} day(s) away)`
    )

    const { error: sendError } = await resend.emails.send({
      from: "StarFlow Alerts <onboarding@resend.dev>",
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
    .select("id, file_name, abstract_data, user_id")

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
    const userId = recordsById.get(alert.recordId)?.user_id

    if (!userId) {
      console.warn(
        `[CRON] Skipping alert for "${alert.fileName}" — record has no user_id.`
      )
      continue
    }

    // Individual send failures are caught and logged inside
    // sendLeaseAlertEmail itself, so one bad recipient/API error never
    // aborts the loop for the rest of the day's alerts.
    await sendLeaseAlertEmail({ userId, alert, supabaseAdmin })
    sentCount += 1
  }

  console.log(
    `[CRON] Processed ${records.length} lease(s); attempted ${sentCount} alert(s).`
  )

  return Response.json({
    processedLeases: records.length,
    alertsSent: sentCount,
  })
}
