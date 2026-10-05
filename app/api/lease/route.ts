import { anthropic } from "@ai-sdk/anthropic"
import { revalidatePath } from "next/cache"
import { streamObject } from "ai"

import { LLM_MODEL_ID } from "@/lib/ai/model"
import { hydrateCanonicalLease } from "@/lib/lease/hydrate"
import { MAX_LEASE_REQUEST_BYTES } from "@/lib/lease/limits"
import { validateLeaseUpload } from "@/lib/lease/validate"
import { getOrgContext } from "@/lib/org/context"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { FREE_LEASE_ABSTRACT_LIMIT } from "@/lib/stripe/constants"
import { createClient } from "@/lib/supabase/server"
import { leaseAbstractSchema } from "./schema"
import type { PortfolioLeaseAbstract } from "@/lib/lease/portfolio-metrics"

export const maxDuration = 60

const SYSTEM_PROMPT = `You are an expert commercial real estate attorney acting as a Commercial Lease Abstractor.

Carefully read the entire attached PDF lease document and extract every requested field. Quote or closely paraphrase the source document rather than guessing. If a field genuinely isn't addressed in the document, say so explicitly (e.g. "Not specified in the document") instead of inventing a value. Convert rent to a monthly numeric amount when possible. Use ISO YYYY-MM-DD for noticeDeadlines.targetDate when the date is parseable. Ignore placeholders such as [●], TBD, or "Not specified". This tool does not provide legal advice.`

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[Lease API Error]: ANTHROPIC_API_KEY is not configured")
    return new Response("Lease analysis is not configured on the server.", {
      status: 500,
    })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
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

  const rateLimit = await checkRateLimit(supabase, "lease", org.orgId)
  if (rateLimit !== "ok") return rateLimitResponse(rateLimit, "lease")

  // Cheap rejection from the declared length before buffering the body; the
  // header can be absent/lying, so the real length is re-checked below.
  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (declaredLength > MAX_LEASE_REQUEST_BYTES) {
    return new Response("File is too large.", { status: 413 })
  }

  const rawBody = await req.text()
  if (rawBody.length > MAX_LEASE_REQUEST_BYTES) {
    return new Response("File is too large.", { status: 413 })
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return new Response("Invalid JSON body.", { status: 400 })
  }

  const validation = validateLeaseUpload(parsedBody, org.orgId)
  if (!validation.ok) {
    return new Response(validation.message, { status: validation.status })
  }
  const { fileName, storagePath, fileBase64 } = validation.value

  // Atomically reserve one analysis slot (advisory-locked in Postgres, counts
  // saved abstracts + in-flight claims) so concurrent uploads can't all pass
  // a "count < limit" check. NULL means the free limit is reached.
  const { data: claimId, error: claimError } = await supabase.rpc(
    "claim_lease_analysis",
    { p_org_id: org.orgId, p_free_limit: FREE_LEASE_ABSTRACT_LIMIT }
  )

  if (claimError) {
    console.error("[Lease API Error] claim_lease_analysis:", claimError.message)
    return new Response("Service temporarily unavailable. Please try again.", {
      status: 503,
    })
  }

  if (!claimId) {
    console.warn(
      `[Lease API] Blocked upload for org ${org.orgId}: free limit (${FREE_LEASE_ABSTRACT_LIMIT}) reached.`
    )
    return new Response(
      `You've reached the free plan limit of ${FREE_LEASE_ABSTRACT_LIMIT} lease abstracts. Upgrade to Pro for unlimited abstracts.`,
      { status: 402 }
    )
  }

  const releaseClaim = async () => {
    const { error } = await supabase.rpc("release_lease_analysis_claim", {
      p_claim_id: claimId,
    })
    if (error) {
      console.error("[Lease API Error] release claim:", error.message)
    }
  }

  try {
    const result = streamObject({
      model: anthropic(LLM_MODEL_ID),
      schema: leaseAbstractSchema,
      system: SYSTEM_PROMPT,
      abortSignal: req.signal,
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
      onError: async ({ error }) => {
        console.error("[Lease API Error] streaming error:", error)
        await releaseClaim()
      },
      onFinish: async ({ object, error }) => {
        try {
          if (error || !object) {
            console.error("[Lease API Error] schema validation failed:", error)
            return
          }

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

          // Audit log is written inside hydrateCanonicalLease. Invalidate
          // the dashboard so Overview / CAM / ASC 842 Server Components
          // pick up the new property + lease without a hard reload.
          revalidatePath("/app", "layout")
        } catch (persistError) {
          console.error(
            "[Lease API Error] failed to persist abstract:",
            persistError
          )
        } finally {
          // The saved row now counts toward the limit; drop the reservation.
          await releaseClaim()
        }
      },
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error("[Lease API Error]:", error)
    await releaseClaim()
    return new Response("Failed to analyze the lease. Please try again.", {
      status: 500,
    })
  }
}
