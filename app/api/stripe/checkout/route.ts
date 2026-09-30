import { NextResponse } from "next/server"

import { stripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Creates a Stripe Checkout Session for the Pro plan and returns its URL
 * for the client to redirect to. Called from
 * components/dashboard/lease-uploader.tsx once a free user hits
 * FREE_LEASE_ABSTRACT_LIMIT.
 */
export async function POST(request: Request) {
  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID

  if (!priceId) {
    console.error("[Stripe Checkout] NEXT_PUBLIC_STRIPE_PRO_PRICE_ID is not configured.")
    return new Response(
      "NEXT_PUBLIC_STRIPE_PRO_PRICE_ID is not configured on the server.",
      { status: 500 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return new Response("Unauthorized. Please sign in to upgrade.", {
      status: 401,
    })
  }

  const origin = new URL(request.url).origin

  // Reuse an existing Stripe customer if this user has one already, so
  // repeat checkouts (e.g. after a cancellation) don't create duplicate
  // Stripe customers for the same person. This is a plain read, so the
  // admin client is used purely for convenience, not to bypass anything
  // security-sensitive — the user's identity was already verified above.
  const supabaseAdmin = createAdminClient()
  const { data: existingSubscription } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle<{ stripe_customer_id: string | null }>()

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      ...(existingSubscription?.stripe_customer_id
        ? { customer: existingSubscription.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [{ price: priceId, quantity: 1 }],
      // Stamping userId on the subscription itself (not just the checkout
      // session) means later `customer.subscription.updated/deleted`
      // webhook events can resolve the owning user without needing to
      // look up the original checkout session.
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    })

    if (!session.url) {
      console.error("[Stripe Checkout] Session created but has no URL.")
      return new Response("Stripe did not return a checkout URL.", {
        status: 500,
      })
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("[Stripe Checkout Error]:", error)
    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to create checkout session.",
      { status: 500 }
    )
  }
}
