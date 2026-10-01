import Stripe from "stripe"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * NEW env:
 *   STRIPE_SECRET_KEY  Secret key for Checkout, Customer Portal, and webhooks.
 */

const secretKey = process.env.STRIPE_SECRET_KEY

if (!secretKey) {
  console.warn(
    "[Stripe] STRIPE_SECRET_KEY is not configured — Stripe API calls will fail until it's set in .env.local."
  )
}

export const stripe = new Stripe(secretKey ?? "", {
  typescript: true,
})

export type SubscriptionStatus = "free" | Stripe.Subscription.Status

const PRO_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"])

export type OrgSubscription = {
  userId: string | null
  organizationId: string | null
  status: SubscriptionStatus
  priceId: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  isPro: boolean
}

type SubscriptionRow = {
  user_id: string | null
  organization_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  price_id: string | null
  current_period_end: string | null
}

const emptySubscription = (
  organizationId: string | null,
  userId: string | null
): OrgSubscription => ({
  userId,
  organizationId,
  status: "free",
  priceId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  isPro: false,
})

const fromRow = (data: SubscriptionRow): OrgSubscription => {
  const status = (data.status || "free") as SubscriptionStatus
  return {
    userId: data.user_id,
    organizationId: data.organization_id,
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

/**
 * Billing is per organization. Falls back to the owner's user_id row for
 * subscriptions created before org_id existed.
 */
export const getOrgSubscription = async (
  organizationId: string,
  fallbackUserId?: string
): Promise<OrgSubscription> => {
  const supabaseAdmin = createAdminClient()

  if (organizationId) {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "user_id, organization_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end"
      )
      .eq("organization_id", organizationId)
      .maybeSingle<SubscriptionRow>()

    if (error) {
      console.error(
        `[Stripe] Failed to fetch subscription for org ${organizationId}:`,
        error.message
      )
    }

    if (data) return fromRow(data)
  }

  if (!fallbackUserId) return emptySubscription(organizationId || null, null)

  const { data: byUser, error: userError } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, organization_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end"
    )
    .eq("user_id", fallbackUserId)
    .maybeSingle<SubscriptionRow>()

  if (userError) {
    console.error(
      `[Stripe] Failed to fetch subscription for user_id ${fallbackUserId}:`,
      userError.message
    )
  }

  if (!byUser) return emptySubscription(organizationId, fallbackUserId)
  return fromRow(byUser)
}

/** @deprecated Prefer getOrgSubscription — kept for call sites that still have only a user id. */
export const getUserSubscription = async (
  userId: string
): Promise<OrgSubscription> => getOrgSubscription("", userId)
