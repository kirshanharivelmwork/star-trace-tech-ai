import { z } from "zod"

export const noticeDeadlineSchema = z.object({
  label: z
    .string()
    .describe("Short name for this deadline, e.g. \"Break option\" or \"Renewal notice\"."),
  targetDate: z
    .string()
    .describe(
      "The deadline date as ISO YYYY-MM-DD when parseable; otherwise the date as written. Use a placeholder phrase if unparseable."
    ),
  noticeDays: z
    .number()
    .nullable()
    .describe("Required notice period in days, or null if not stated."),
})

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
  propertyName: z
    .string()
    .describe(
      "Building or property name if stated; otherwise a short label derived from the premises address."
    ),
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
  premisesSquareFootage: z
    .number()
    .nullable()
    .describe(
      "Rentable / lettable square footage as a number, or null if not stated. Ignore placeholders such as [●] or TBD."
    ),
  monthlyBaseRentAmount: z
    .number()
    .nullable()
    .describe(
      "Initial base rent converted to a monthly amount in the document's currency. If rent is stated annually, divide by 12. Null if not stated."
    ),
  rentPaymentFrequency: z
    .string()
    .describe(
      "How often rent is paid as written (monthly, quarterly, annually). Use \"Not specified in the document\" if absent."
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
  noticeDeadlines: z
    .array(noticeDeadlineSchema)
    .describe(
      "Parseable notice, break, and renewal deadlines. Omit entries whose dates cannot be parsed."
    ),
  discountRateAnnual: z
    .number()
    .nullable()
    .describe(
      "Stated discount / incremental borrowing rate as an annual decimal (e.g. 0.05 for 5%), or null if not in the document."
    ),
  keyObligationsAndRestrictions: z
    .array(z.string())
    .describe(
      "Key tenant/landlord obligations and use restrictions, each as a separate string."
    ),
})

export type LeaseAbstract = z.infer<typeof leaseAbstractSchema>
export type NoticeDeadline = z.infer<typeof noticeDeadlineSchema>

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
  organization_id?: string | null
  lease_id?: string | null
  file_name: string
  storage_path: string
  abstract_data: LeaseAbstract
  needs_review?: boolean | null
  created_at: string
}
