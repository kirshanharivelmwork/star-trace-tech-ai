import type Stripe from "stripe"

import { stripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Never statically cache/prerender — this is a live webhook endpoint.
export const dynamic = "force-dynamic"

/**
 * Billing is one row per organization: `subscriptions.organization_id` has a
 * unique index (migration 20261005020000_subscriptions_org_unique.sql), which is
 * the `onConflict` target of every write below. All writes are upserts of
 * the *current* Stripe state, so replays and out-of-order delivery converge
 * on the same row.
 *
 * Failure contract: any database or Stripe API error throws, which returns
 * 500 so Stripe retries. Only events that can never succeed on retry
 * (unsupported types, no way to attribute to an org) return 200.
 */
const SUBSCRIPTIONS_ON_CONFLICT = "organization_id"

/**
 * Resolves the Stripe subscription's current period end. In the installed
 * `stripe` SDK's API version (2026-08-26.dahlia), `current_period_end`
 * lives on each subscription *item*, not on the top-level Subscription
 * object — Stripe moved it there to support multi-item subscriptions with
 * different billing cycles per item.
 */
const getCurrentPeriodEnd = (
  subscription: Stripe.Subscription
): string | null => {
  const periodEndSeconds = subscription.items.data[0]?.current_period_end
  return periodEndSeconds
    ? new Date(periodEndSeconds * 1000).toISOString()
    : null
}

const getPriceId = (subscription: Stripe.Subscription): string | null =>
  subscription.items.data[0]?.price?.id ?? null

const getCustomerId = (
  customer:
    Stripe.Checkout.Session["customer"] | Stripe.Subscription["customer"]
): string | null =>
  typeof customer === "string" ? customer : (customer?.id ?? null)

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
])

type AdminClient = ReturnType<typeof createAdminClient>

type SyncResult = "synced" | "unattributable"

/**
 * Loads the live subscription so an out-of-order or replayed event can never
 * overwrite newer state with an older payload. Falls back to the event's own
 * payload only if Stripe says the subscription no longer exists.
 */
const loadCurrentSubscription = async (
  fromEvent: Stripe.Subscription
): Promise<Stripe.Subscription> => {
  try {
    return await stripe.subscriptions.retrieve(fromEvent.id)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === "resource_missing") return fromEvent
    throw error
  }
}

/**
 * Upserts the org's subscription row from a Stripe subscription. Org and
 * user attribution come from (in order): explicit hints from the caller,
 * subscription metadata, then an existing row for the same Stripe
 * subscription id.
 */
const syncSubscription = async (params: {
  supabaseAdmin: AdminClient
  subscription: Stripe.Subscription
  statusOverride?: string
  orgIdHint?: string | null
  userIdHint?: string | null
}): Promise<SyncResult> => {
  const { supabaseAdmin, subscription, statusOverride } = params

  let orgId: string | null =
    params.orgIdHint ?? subscription.metadata?.orgId ?? null
  const userId = params.userIdHint ?? subscription.metadata?.userId ?? null

  if (!orgId) {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle<{ organization_id: string | null }>()

    if (error) {
      throw new Error(
        `subscription lookup by stripe_subscription_id failed: ${error.message}`
      )
    }
    orgId = data?.organization_id ?? null
  }

  if (!orgId) {
    // Retrying cannot fix this (no org in metadata, no existing row), so
    // don't make Stripe retry for days — but make it loud in the logs.
    console.error(
      `[Stripe Webhook] Cannot attribute subscription ${subscription.id} to an organization (no orgId in metadata, no existing row).`
    )
    return "unattributable"
  }

  const status = statusOverride ?? subscription.status

  // A terminal event for an OLD subscription (replayed or late) must not
  // clobber the row once the org has moved on to a newer subscription.
  if (TERMINAL_STATUSES.has(status)) {
    const { data: current, error: currentError } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("organization_id", orgId)
      .maybeSingle<{ stripe_subscription_id: string | null }>()

    if (currentError) {
      throw new Error(
        `subscriptions lookup failed for org ${orgId}: ${currentError.message}`
      )
    }

    const currentId = current?.stripe_subscription_id
    if (currentId && currentId !== subscription.id) {
      console.warn(
        `[Stripe Webhook] Ignoring ${status} for superseded subscription ${subscription.id} (org ${orgId} is on ${currentId}).`
      )
      return "synced"
    }
  }

  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      organization_id: orgId,
      ...(userId ? { user_id: userId } : {}),
      stripe_customer_id: getCustomerId(subscription.customer),
      stripe_subscription_id: subscription.id,
      status,
      price_id: getPriceId(subscription),
      current_period_end: getCurrentPeriodEnd(subscription),
      updated_at: new Date().toISOString(),
    },
    { onConflict: SUBSCRIPTIONS_ON_CONFLICT }
  )

  if (error) {
    throw new Error(
      `subscriptions upsert failed for org ${orgId}: ${error.message}`
    )
  }

  return "synced"
}

const handleCheckoutCompleted = async (
  supabaseAdmin: AdminClient,
  session: Stripe.Checkout.Session
): Promise<void> => {
  if (session.mode !== "subscription") return

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null)

  if (!subscriptionId) {
    console.error(
      `[Stripe Webhook] checkout.session.completed ${session.id} has no subscription id.`
    )
    return
  }

  // Always read the live subscription (rather than trusting event order) so
  // this is correct even if customer.subscription.updated arrived first.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  await syncSubscription({
    supabaseAdmin,
    subscription,
    orgIdHint: session.metadata?.orgId ?? session.metadata?.organizationId,
    userIdHint: session.client_reference_id ?? session.metadata?.userId,
  })
}

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

  try {
    const supabaseAdmin = createAdminClient()

    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutCompleted(
          supabaseAdmin,
          event.data.object as Stripe.Checkout.Session
        )
        break
      }

      // Plan changes, renewals, cancel-at-period-end, and payment failures:
      // Stripe moves the subscription to `past_due`/`unpaid` and emits this
      // event, which is how a failed payment reaches the gating logic
      // (only `active`/`trialing` count as Pro). No separate
      // invoice.payment_failed handler is needed.
      case "customer.subscription.updated": {
        const fromEvent = event.data.object as Stripe.Subscription
        const subscription = await loadCurrentSubscription(fromEvent)
        await syncSubscription({ supabaseAdmin, subscription })
        break
      }

      // Terminal state: no need to re-fetch, and a stale replay can't be wrong.
      case "customer.subscription.deleted": {
        await syncSubscription({
          supabaseAdmin,
          subscription: event.data.object as Stripe.Subscription,
          statusOverride: "canceled",
        })
        break
      }

      default:
        // Ignore every other event type — nothing else affects billing gating.
        break
    }
  } catch (error) {
    // Includes every Supabase write error and Stripe API error: a 500 makes
    // Stripe retry with backoff instead of silently losing the payment.
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, error)
    return new Response("Webhook handler error.", { status: 500 })
  }

  return new Response(null, { status: 200 })
}
