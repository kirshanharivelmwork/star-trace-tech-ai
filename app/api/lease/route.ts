import { anthropic } from "@ai-sdk/anthropic"
import { streamObject } from "ai"

import { hydrateCanonicalLease } from "@/lib/lease/hydrate"
import { getOrgContext } from "@/lib/org/context"
import { FREE_LEASE_ABSTRACT_LIMIT } from "@/lib/stripe/constants"
import { getOrgSubscription } from "@/lib/stripe/server"
import { createClient } from "@/lib/supabase/server"
import { leaseAbstractSchema, type LeaseAnalysisInput } from "./schema"
import type { PortfolioLeaseAbstract } from "@/lib/lease/portfolio-metrics"

export const maxDuration = 60

const MODEL_ID = "claude-sonnet-4-6"

const SYSTEM_PROMPT = `You are an expert commercial real estate attorney acting as a Commercial Lease Abstractor.

Carefully read the entire attached PDF lease document and extract every requested field. Quote or closely paraphrase the source document rather than guessing. If a field genuinely isn't addressed in the document, say so explicitly (e.g. "Not specified in the document") instead of inventing a value. Convert rent to a monthly numeric amount when possible. Use ISO YYYY-MM-DD for noticeDeadlines.targetDate when the date is parseable. Ignore placeholders such as [●], TBD, or "Not specified". This tool does not provide legal advice.`

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[Lease API Error]: ANTHROPIC_API_KEY is missing in .env.local")
    return new Response("ANTHROPIC_API_KEY is missing in .env.local", {
      status: 500,
    })
  }

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

  const org = await getOrgContext()
  if (!org) {
    return new Response("Workspace is not ready. Refresh and try again.", {
      status: 403,
    })
  }

  if (!org.canWrite) {
    return new Response("You have view-only access to this workspace.", {
      status: 403,
    })
  }

  const subscription = await getOrgSubscription(org.orgId, org.userId)

  if (!subscription.isPro) {
    const { count, error: countError } = await supabase
      .from("lease_abstracts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)

    if (countError) {
      console.error(
        "[Lease API Error] failed to count existing abstracts:",
        countError.message
      )
    } else if ((count ?? 0) >= FREE_LEASE_ABSTRACT_LIMIT) {
      console.warn(
        `[Lease API] Blocked upload for org ${org.orgId}: free limit (${FREE_LEASE_ABSTRACT_LIMIT}) reached.`
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
          const { data: inserted, error: insertError } = await supabase
            .from("lease_abstracts")
            .insert({
              file_name: fileName,
              storage_path: storagePath,
              abstract_data: object,
              user_id: user.id,
              organization_id: org.orgId,
            })
            .select("id")
            .single()

          if (insertError || !inserted) {
            console.error(
              "[Lease API Error] failed to persist abstract:",
              insertError?.message
            )
            return
          }

          await hydrateCanonicalLease({
            supabase,
            userId: user.id,
            organizationId: org.orgId,
            abstractId: inserted.id as string,
            fileName,
            abstract: object as PortfolioLeaseAbstract,
          })
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
