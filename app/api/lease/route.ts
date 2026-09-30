import { anthropic } from "@ai-sdk/anthropic"
import { streamObject } from "ai"

import { FREE_LEASE_ABSTRACT_LIMIT } from "@/lib/stripe/constants"
import { getUserSubscription } from "@/lib/stripe/server"
import { createClient } from "@/lib/supabase/server"
import { leaseAbstractSchema, type LeaseAnalysisInput } from "./schema"

// Dedicated endpoint for the Commercial Lease Abstractor (see
// components/dashboard/lease-uploader.tsx and abstract-viewer.tsx). Kept
// separate from app/api/chat/route.ts so the general-purpose dashboard
// assistant keeps its own persona and isn't affected by changes here.

// PDF lease analysis can take longer than a simple chat reply, so allow
// extra time for the model to finish.
export const maxDuration = 60

// "claude-3-5-sonnet-20241022" was retired by Anthropic. Kept as a single
// constant so it can be swapped again in one place if this model is
// deprecated in the future.
const MODEL_ID = "claude-sonnet-4-6"

const SYSTEM_PROMPT = `You are an expert commercial real estate attorney acting as a Commercial Lease Abstractor.

Carefully read the entire attached PDF lease document and extract every requested field. Quote or closely paraphrase the source document rather than guessing. If a field genuinely isn't addressed in the document, say so explicitly (e.g. "Not specified in the document") instead of inventing a value. This tool does not provide legal advice.`

// `useObject` (the client hook) reads the raw response body text as the
// `Error` message whenever `response.ok` is false — so error responses from
// this route are returned as plain text, not JSON, to keep that message
// clean for the client to display.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[Lease API Error]: ANTHROPIC_API_KEY is missing in .env.local")
    return new Response("ANTHROPIC_API_KEY is missing in .env.local", {
      status: 500,
    })
  }

  // Auth via the existing @supabase/ssr server client (see
  // lib/supabase/server.ts) — reused below for the lease_abstracts insert
  // so `auth.uid()` resolves correctly for RLS.
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    console.error("[Lease API Error]: unauthenticated request to /api/lease")
    return new Response("Unauthorized. Please sign in to analyze a lease.", {
      status: 401,
    })
  }

  // Billing gate: free accounts get FREE_LEASE_ABSTRACT_LIMIT abstracts
  // total, ever; Pro (active/trialing in the `subscriptions` table) is
  // unlimited. This is the authoritative check — the client-side gate in
  // lease-uploader.tsx is UX only and must never be trusted on its own.
  const subscription = await getUserSubscription(user.id)

  if (!subscription.isPro) {
    const { count, error: countError } = await supabase
      .from("lease_abstracts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)

    if (countError) {
      console.error(
        "[Lease API Error] failed to count existing abstracts:",
        countError.message
      )
    } else if ((count ?? 0) >= FREE_LEASE_ABSTRACT_LIMIT) {
      console.warn(
        `[Lease API] Blocked upload for user_id ${user.id}: free limit (${FREE_LEASE_ABSTRACT_LIMIT}) reached.`
      )
      return new Response(
        `You've reached the free plan limit of ${FREE_LEASE_ABSTRACT_LIMIT} lease abstracts. Upgrade to Pro for unlimited abstracts.`,
        { status: 402 }
      )
    }
  }

  try {
    const { fileName, storagePath, fileBase64 }: LeaseAnalysisInput =
      await req.json()

    if (!fileName || !fileBase64) {
      return new Response("Missing fileName or file data in request body.", {
        status: 400,
      })
    }

    const result = streamObject({
      model: anthropic(MODEL_ID),
      schema: leaseAbstractSchema,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze the attached commercial lease PDF ("${fileName}") and extract its key terms.`,
            },
            {
              type: "file",
              // Bare base64 string — the AI SDK inlines this as base64
              // document data sent directly to Claude, rather than a URL
              // Anthropic's servers would need to fetch.
              data: fileBase64,
              mediaType: "application/pdf",
              filename: fileName,
            },
          ],
        },
      ],
      onError: ({ error }) => {
        console.error("[Lease API Error] streaming error:", error)
      },
      onFinish: async ({ object, error }) => {
        if (error || !object) {
          console.error("[Lease API Error] schema validation failed:", error)
          return
        }

        try {
          const { error: insertError } = await supabase
            .from("lease_abstracts")
            .insert({
              file_name: fileName,
              storage_path: storagePath,
              abstract_data: object,
              user_id: user.id,
            })

          if (insertError) {
            console.error(
              "[Lease API Error] failed to persist abstract:",
              insertError.message
            )
          }
        } catch (persistError) {
          console.error(
            "[Lease API Error] failed to persist abstract:",
            persistError
          )
        }
      },
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error("[Lease API Error]:", error)
    return new Response(
      error instanceof Error
        ? error.message
        : "Unknown error while analyzing the lease.",
      { status: 500 }
    )
  }
}
