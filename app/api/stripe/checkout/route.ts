import { NextResponse } from "next/server"

import { getAppUrl } from "@/lib/email/from"
import { getOrgContext } from "@/lib/org/context"
import { stripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * NEW env:
 *   NEXT_PUBLIC_APP_URL             Canonical origin for success/cancel URLs
 *   NEXT_PUBLIC_STRIPE_PRO_PRICE_ID Pro plan price
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

  const org = await getOrgContext()
  if (!org) {
    return new Response("Workspace is not ready.", { status: 403 })
  }

  const origin = getAppUrl() || new URL(request.url).origin

  const supabaseAdmin = createAdminClient()
  const { data: existingSubscription } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", org.orgId)
    .maybeSingle<{ stripe_customer_id: string | null }>()

  const existingCustomer = existingSubscription?.stripe_customer_id
    ? existingSubscription.stripe_customer_id
    : null

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      ...(existingCustomer
        ? { customer: existingCustomer }
        : { customer_email: user.email }),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: user.id, orgId: org.orgId },
      subscription_data: {
        metadata: { userId: user.id, orgId: org.orgId },
      },
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/app?checkout=cancelled`,
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
