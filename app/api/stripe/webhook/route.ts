import type Stripe from "stripe"

import { stripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Never statically cache/prerender — this is a live webhook endpoint.
export const dynamic = "force-dynamic"

/**
 * Resolves the Stripe subscription's current period end. In the installed
 * `stripe` SDK's API version (2026-08-26.dahlia), `current_period_end`
 * lives on each subscription *item*, not on the top-level Subscription
 * object — Stripe moved it there to support multi-item subscriptions with
 * different billing cycles per item.
 */
const getCurrentPeriodEnd = (subscription: Stripe.Subscription): string | null => {
  const periodEndSeconds = subscription.items.data[0]?.current_period_end
  return periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null
}

const getPriceId = (subscription: Stripe.Subscription): string | null =>
  subscription.items.data[0]?.price?.id ?? null

const getCustomerId = (
  customer: Stripe.Checkout.Session["customer"] | Stripe.Subscription["customer"]
): string | null => (typeof customer === "string" ? customer : customer?.id ?? null)

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get("stripe-signature")

  if (!webhookSecret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured.")
    return new Response("Webhook secret not configured.", { status: 500 })
  }

  if (!signature) {
    return new Response("Missing stripe-signature header.", { status: 400 })
  }

  // Signature verification requires the exact raw request bytes — never
  // parse this as JSON first.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    console.error("[Stripe Webhook] Signature verification failed:", error)
    return new Response("Invalid signature.", { status: 400 })
  }

  const supabaseAdmin = createAdminClient()

  try {
    switch (event.type) {
      // Fired once, right after a Checkout Session finishes — this is the
      // only handler that has `client_reference_id` (our user id) reliably
      // available, so it's responsible for creating the subscriptions row.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.client_reference_id

        if (!userId) {
          console.warn(
            "[Stripe Webhook] checkout.session.completed with no client_reference_id — cannot attribute to a user."
          )
          break
        }

        const customerId = getCustomerId(session.customer)
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null

        let status: string = "active"
        let priceId: string | null = null
        let currentPeriodEnd: string | null = null

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)
          status = subscription.status
          priceId = getPriceId(subscription)
          currentPeriodEnd = getCurrentPeriodEnd(subscription)
        }

        const { error } = await supabaseAdmin.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status,
          price_id: priceId,
          current_period_end: currentPeriodEnd,
          updated_at: new Date().toISOString(),
        })

        if (error) {
          console.error(
            `[Stripe Webhook] Failed to upsert subscription for user_id ${userId}:`,
            error.message
          )
        }

        break
      }

      // Covers plan changes, renewals, cancellations-at-period-end, and
      // (for .deleted) immediate cancellation.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId ?? null
        const customerId = getCustomerId(subscription.customer)

        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : subscription.status

        const updatePayload = {
          stripe_subscription_id: subscription.id,
          status,
          price_id: getPriceId(subscription),
          current_period_end: getCurrentPeriodEnd(subscription),
          updated_at: new Date().toISOString(),
        }

        // Prefer matching on user_id (set via subscription_data.metadata
        // at checkout time); fall back to stripe_customer_id for
        // subscriptions that predate that metadata, or events that arrive
        // out of order relative to checkout.session.completed.
        // `{ count: "exact" }` is required for `.update()` to report back
        // how many rows it actually matched.
        const query = userId
          ? supabaseAdmin
              .from("subscriptions")
              .update(updatePayload, { count: "exact" })
              .eq("user_id", userId)
          : customerId
            ? supabaseAdmin
                .from("subscriptions")
                .update(updatePayload, { count: "exact" })
                .eq("stripe_customer_id", customerId)
            : null

        if (!query) {
          console.warn(
            `[Stripe Webhook] ${event.type} for subscription ${subscription.id} has no user_id metadata or customer id — cannot attribute to a user.`
          )
          break
        }

        const { error, count } = await query
        if (error) {
          console.error(
            `[Stripe Webhook] Failed to update subscription ${subscription.id}:`,
            error.message
          )
        } else if (!count) {
          console.warn(
            `[Stripe Webhook] ${event.type} for subscription ${subscription.id} matched no existing row (userId=${userId}, customerId=${customerId}).`
          )
        }

        break
      }

      default:
        // Ignore every other event type — nothing else affects billing gating.
        break
    }
  } catch (error) {
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, error)
    return new Response("Webhook handler error.", { status: 500 })
  }

  return new Response(null, { status: 200 })
}
