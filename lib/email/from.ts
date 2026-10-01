/**
 * NEW env (document here — the file that reads them):
 *   RESEND_FROM        Production From header, e.g. "StarFlow Alerts <alerts@domain.com>"
 *   RESEND_FROM_EMAIL  Address-only fallback used to build the From header
 *
 * Production MUST send from a verified Resend domain. `onboarding@resend.dev`
 * is a development-only fallback and will fail (or land in spam) in prod.
 */
export const getResendFromAddress = (): string => {
  const from = process.env.RESEND_FROM?.trim()
  if (from) return from

  const email = process.env.RESEND_FROM_EMAIL?.trim()
  if (email) return `StarFlow Alerts <${email}>`

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[email] RESEND_FROM (or RESEND_FROM_EMAIL) must be a verified domain in production."
    )
  }

  return "StarFlow Alerts <onboarding@resend.dev>"
}

/**
 * NEW env:
 *   NEXT_PUBLIC_APP_URL  Canonical app origin for auth redirects, Stripe
 *                        Customer Portal return URLs, and email CTAs.
 */
export const getAppUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  return "http://localhost:3000"
}
