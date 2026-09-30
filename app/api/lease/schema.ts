import { z } from "zod"

// Shared between the server route (app/api/lease/route.ts) and every client
// component that renders or exports a lease abstract, per the AI SDK's
// recommendation to define structured-output schemas in one file that's
// imported on both sides.
export const leaseAbstractSchema = z.object({
  landlordName: z
    .string()
    .describe("Full legal name of the landlord/lessor named in the lease."),
  tenantName: z
    .string()
    .describe("Full legal name of the tenant/lessee named in the lease."),
  premisesAddress: z
    .string()
    .describe("Full postal address of the leased premises."),
  contractualTerm: z
    .string()
    .describe("The length of the lease term, e.g. \"10 years\"."),
  commencementDate: z
    .string()
    .describe("The lease commencement date, as written in the document."),
  expirationDate: z
    .string()
    .describe("The lease expiration date, as written in the document."),
  initialBaseRent: z
    .string()
    .describe(
      "The initial base rent amount and payment frequency, e.g. \"$120,000/year, paid monthly in advance\"."
    ),
  rentReviewDetails: z
    .string()
    .describe(
      "How and when rent is reviewed or escalated over the term (fixed increases, CPI-linked, market review, etc.)."
    ),
  camServiceChargeTerms: z
    .string()
    .describe(
      "How Common Area Maintenance / service charges are calculated, what they include or exclude, and any caps."
    ),
  terminationAndBreakClauses: z
    .array(z.string())
    .describe(
      "Each termination or break option as a separate string, including notice requirements and conditions."
    ),
  keyObligationsAndRestrictions: z
    .array(z.string())
    .describe(
      "Key tenant/landlord obligations and use restrictions, each as a separate string."
    ),
})

export type LeaseAbstract = z.infer<typeof leaseAbstractSchema>

/** JSON body shape sent from the client to POST /api/lease. */
export type LeaseAnalysisInput = {
  fileName: string
  storagePath: string
  fileBase64: string
}

/** Row shape of the `lease_abstracts` table. */
export type LeaseAbstractRecord = {
  id: string
  user_id: string
  file_name: string
  storage_path: string
  abstract_data: LeaseAbstract
  created_at: string
}
