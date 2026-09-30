import Stripe from "stripe"

import { createAdminClient } from "@/lib/supabase/admin"

const secretKey = process.env.STRIPE_SECRET_KEY

if (!secretKey) {
  console.warn(
    "[Stripe] STRIPE_SECRET_KEY is not configured — Stripe API calls will fail until it's set in .env.local."
  )
}

// `apiVersion` intentionally omitted so the SDK uses whatever version is
// bundled with the installed `stripe` package (currently 22.6.2 /
// 2026-08-26.dahlia) — always matches the TypeScript types this file was
// written against.
export const stripe = new Stripe(secretKey ?? "", {
  typescript: true,
})

export type SubscriptionStatus =
  | "free"
  | Stripe.Subscription.Status

/** Subscription statuses that grant Pro access — `trialing` intentionally included. */
const PRO_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"])

export type UserSubscription = {
  userId: string
  status: SubscriptionStatus
  priceId: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  isPro: boolean
}

type SubscriptionRow = {
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  price_id: string | null
  current_period_end: string | null
}

/**
 * Resolves a user's current billing status directly from the
 * `subscriptions` table (kept in sync by app/api/stripe/webhook/route.ts)
 * via the service-role client. Deliberately takes just a `userId` and
 * manages its own DB access rather than depending on a cookie-scoped
 * request context, so it can be called from anywhere on the server — a
 * Route Handler, a Server Component, or a cron job — not just inside an
 * authenticated request.
 *
 * A user with no row in `subscriptions` (never checked out) is treated as
 * `free`, not an error.
 */
export const getUserSubscription = async (
  userId: string
): Promise<UserSubscription> => {
  const supabaseAdmin = createAdminClient()

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end"
    )
    .eq("user_id", userId)
    .maybeSingle<SubscriptionRow>()

  if (error) {
    console.error(
      `[Stripe] Failed to fetch subscription for user_id ${userId}:`,
      error.message
    )
  }

  if (!data) {
    return {
      userId,
      status: "free",
      priceId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      isPro: false,
    }
  }

  const status = (data.status || "free") as SubscriptionStatus

  return {
    userId,
    status,
    priceId: data.price_id,
    stripeCustomerId: data.stripe_customer_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    currentPeriodEnd: data.current_period_end
      ? new Date(data.current_period_end)
      : null,
    isPro: PRO_STATUSES.has(status),
  }
}
