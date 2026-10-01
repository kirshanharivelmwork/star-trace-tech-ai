"use client"

import { useState } from "react"
import type { DeepPartial } from "ai"
import { Check, Copy, FileJson, FileSpreadsheet, Sparkles } from "lucide-react"

import { LeaseChat } from "@/components/dashboard/lease-chat"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import type { LeaseAbstract } from "@/app/api/lease/schema"

type AbstractViewerProps = {
  abstract: DeepPartial<LeaseAbstract> | undefined
  fileName: string | null
  isLoading: boolean
  errorMessage?: string | null
  leaseAbstractId?: string | null
}

const FIELD_LABELS: Record<string, string> = {
  landlordName: "Landlord",
  tenantName: "Tenant",
  premisesAddress: "Premises address",
  propertyName: "Property name",
  contractualTerm: "Contractual term",
  commencementDate: "Commencement date",
  expirationDate: "Expiration date",
  initialBaseRent: "Initial base rent",
  premisesSquareFootage: "Square footage",
  monthlyBaseRentAmount: "Monthly base rent",
  rentPaymentFrequency: "Rent payment frequency",
  rentReviewDetails: "Rent review details",
  camServiceChargeTerms: "CAM / service charge terms",
  terminationAndBreakClauses: "Termination & break clauses",
  noticeDeadlines: "Notice deadlines",
  discountRateAnnual: "Discount / IBR",
  keyObligationsAndRestrictions: "Key obligations & restrictions",
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const baseName = (fileName: string | null) =>
  (fileName ?? "lease-abstract").replace(/\.pdf$/i, "")

const toCsv = (abstract: DeepPartial<LeaseAbstract>) => {
  const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`

  const rows = (Object.keys(FIELD_LABELS) as Array<keyof LeaseAbstract>).map(
    (key) => {
      const value = abstract[key as keyof LeaseAbstract]
      const cell = Array.isArray(value)
        ? value
            .map((item) =>
              typeof item === "string" ? item : JSON.stringify(item)
            )
            .join("; ")
        : value == null
          ? ""
          : String(value)

      return `${escapeCell(FIELD_LABELS[key] ?? key)},${escapeCell(String(cell))}`
    }
  )

  return ["Field,Value", ...rows].join("\n")
}

const StringField = ({
  label,
  value,
  isLoading,
}: {
  label: string
  value: string | undefined
  isLoading: boolean
}) => (
  <div className="flex flex-col gap-1 border-b border-border/60 py-2 last:border-b-0">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    {value ? (
      <span className="text-sm text-foreground">{value}</span>
    ) : isLoading ? (
      <Skeleton className="h-4 w-3/4" />
    ) : (
      <span className="text-sm text-muted-foreground">Not available</span>
    )}
  </div>
)

const ListField = ({
  label,
  values,
  isLoading,
}: {
  label: string
  values: Array<string | undefined> | undefined
  isLoading: boolean
}) => {
  const items = (values ?? []).filter((item): item is string => Boolean(item))

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {items.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
          {items.map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : isLoading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">Not available</span>
      )}
    </div>
  )
}

export const AbstractViewer = ({
  abstract,
  fileName,
  isLoading,
  errorMessage,
  leaseAbstractId,
}: AbstractViewerProps) => {
  const [copied, setCopied] = useState(false)

  const handleExportJson = () => {
    if (!abstract) return
    downloadBlob(
      new Blob([JSON.stringify(abstract, null, 2)], {
        type: "application/json",
      }),
      `${baseName(fileName)}-abstract.json`
    )
  }

  const handleExportCsv = () => {
    if (!abstract) return
    downloadBlob(
      new Blob([toCsv(abstract)], { type: "text/csv" }),
      `${baseName(fileName)}-abstract.csv`
    )
  }

  const handleCopy = async () => {
    if (!abstract) return
    await navigator.clipboard.writeText(JSON.stringify(abstract, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasAnyData = Boolean(abstract && Object.keys(abstract).length > 0)
  const disableActions = !hasAnyData

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle>Lease Abstract</CardTitle>
          {fileName ? (
            <span className="text-xs text-muted-foreground">{fileName}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Sheet>
            <SheetTrigger render={<Button variant="outline" size="sm" disabled={!fileName} />}>
              <Sparkles className="size-3.5" />
              Ask AI
            </SheetTrigger>

            <SheetContent
              side="right"
              className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
            >
              <SheetTitle className="sr-only">
                Ask AI about {fileName ?? "this lease"}
              </SheetTitle>
              <LeaseChat
                abstractData={abstract}
                fileName={fileName}
                leaseAbstractId={leaseAbstractId}
              />
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            disabled={disableActions}
          >
            <FileJson className="size-3.5" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={disableActions}
          >
            <FileSpreadsheet className="size-3.5" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={handleCopy}
            disabled={disableActions}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span className="sr-only">Copy to clipboard</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {errorMessage ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <StringField
            label={FIELD_LABELS.landlordName}
            value={abstract?.landlordName}
            isLoading={isLoading}
          />
          <StringField
            label={FIELD_LABELS.tenantName}
            value={abstract?.tenantName}
            isLoading={isLoading}
          />
          <div className="sm:col-span-2">
            <StringField
              label={FIELD_LABELS.premisesAddress}
              value={abstract?.premisesAddress}
              isLoading={isLoading}
            />
          </div>
        </div>

        <Separator />

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">Financials</h3>
          <div className="rounded-lg border bg-muted/20 px-3">
            <StringField
              label={FIELD_LABELS.initialBaseRent}
              value={abstract?.initialBaseRent}
              isLoading={isLoading}
            />
            <StringField
              label={FIELD_LABELS.monthlyBaseRentAmount}
              value={
                abstract?.monthlyBaseRentAmount != null
                  ? String(abstract.monthlyBaseRentAmount)
                  : undefined
              }
              isLoading={isLoading}
            />
            <StringField
              label={FIELD_LABELS.premisesSquareFootage}
              value={
                abstract?.premisesSquareFootage != null
                  ? String(abstract.premisesSquareFootage)
                  : undefined
              }
              isLoading={isLoading}
            />
            <StringField
              label={FIELD_LABELS.rentReviewDetails}
              value={abstract?.rentReviewDetails}
              isLoading={isLoading}
            />
            <StringField
              label={FIELD_LABELS.camServiceChargeTerms}
              value={abstract?.camServiceChargeTerms}
              isLoading={isLoading}
            />
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            Critical Dates
          </h3>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {(
                  [
                    ["contractualTerm", FIELD_LABELS.contractualTerm],
                    ["commencementDate", FIELD_LABELS.commencementDate],
                    ["expirationDate", FIELD_LABELS.expirationDate],
                  ] as const
                ).map(([key, label]) => (
                  <tr key={key} className="bg-muted/20">
                    <td className="w-1/3 px-3 py-2 align-top text-xs font-medium text-muted-foreground">
                      {label}
                    </td>
                    <td className="px-3 py-2 align-top text-foreground">
                      {abstract?.[key] ?? (
                        isLoading ? (
                          <Skeleton className="h-4 w-2/3" />
                        ) : (
                          <span className="text-muted-foreground">
                            Not available
                          </span>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            Legal &amp; Restrictions
          </h3>
          <div className="grid gap-4 rounded-lg border bg-muted/20 px-3 py-1 sm:grid-cols-2">
            <ListField
              label={FIELD_LABELS.terminationAndBreakClauses}
              values={abstract?.terminationAndBreakClauses}
              isLoading={isLoading}
            />
            <ListField
              label={FIELD_LABELS.keyObligationsAndRestrictions}
              values={abstract?.keyObligationsAndRestrictions}
              isLoading={isLoading}
            />
          </div>
        </section>
      </CardContent>
    </Card>
  )
}
