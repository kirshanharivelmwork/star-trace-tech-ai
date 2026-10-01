"use client"

import { useActionState, useMemo, useState } from "react"

import { updateLeaseAccountingInputs } from "@/app/finances/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildPortfolioDisclosure } from "@/lib/enterprise/asc842"
import type { LeasePaymentTerm, LeasePresentation } from "@/lib/enterprise/types"

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)

const formatUsdPrecise = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

const formatDate = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type ComplianceBoardProps = {
  terms: LeasePaymentTerm[]
  canWrite?: boolean
}

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const ComplianceBoard = ({
  terms,
  canWrite = false,
}: ComplianceBoardProps) => {
  const schedules = useMemo(() => buildPortfolioDisclosure(terms), [terms])

  const totals = schedules.reduce(
    (acc, schedule) => {
      acc.rou += schedule.initialRou
      acc.liability += schedule.initialLiability
      acc.undiscounted += schedule.undiscountedRemaining
      acc.finance += schedule.financeExpenseTotal
      acc.operating += schedule.operatingExpenseTotal
      return acc
    },
    { rou: 0, liability: 0, undiscounted: 0, finance: 0, operating: 0 }
  )

  if (terms.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-400">
          No in-place leases with remaining rent — ASC 842 schedules need
          monthly_rent and a future end_date. Upload a lease on Overview to
          create that record.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
            Assumptions
          </CardTitle>
          <p className="text-xs text-zinc-400">
            Simplified monthly ordinary annuity. Liability = PV of remaining
            payments. ROU = PV + initial direct costs + prepaid − incentives.
            Presentation (finance vs operating) is a user-selected P&amp;L flag,
            not an auto-classification under the five ASC 842 tests. Not
            audited GAAP and not a replacement for an accountant.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
              Right-of-use asset
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-zinc-50">
              {formatUsd(totals.rou)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
              Lease liability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-zinc-50">
              {formatUsd(totals.liability)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
              Undiscounted remaining
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-zinc-50">
              {formatUsd(totals.undiscounted)}
            </p>
          </CardContent>
        </Card>
      </div>

      {schedules.map((schedule) => {
        const term = terms.find((item) => item.leaseId === schedule.leaseId)
        return (
          <Card key={schedule.leaseId}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
                  {schedule.tenantName}
                </CardTitle>
                <p className="text-xs text-zinc-400">
                  {schedule.propertyName ?? "Unassigned asset"} ·{" "}
                  {schedule.remainingMonths} remaining months ·{" "}
                  {formatUsdPrecise(schedule.monthlyPayment)}/mo · IBR{" "}
                  {(schedule.annualRate * 100).toFixed(2)}% ·{" "}
                  {schedule.presentation}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const header =
                    "period,date,payment,interest,principal,liability,depreciation,rou,finance_expense,operating_expense,period_expense"
                  const rows = schedule.rows.map(
                    (row) =>
                      `${row.period},${row.dateIso},${row.payment},${row.interest},${row.principal},${row.endingLiability},${row.depreciation},${row.endingRou},${row.financeExpense},${row.operatingExpense},${row.periodExpense}`
                  )
                  downloadCsv(
                    `${schedule.tenantName.replace(/\s+/g, "-").toLowerCase()}-asc842.csv`,
                    [header, ...rows].join("\n")
                  )
                }}
              >
                Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              {term && canWrite ? <AccountingInputsForm term={term} /> : null}

              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] tracking-widest text-zinc-500 uppercase">
                    Opening ROU
                  </p>
                  <p className="font-medium tracking-tight text-zinc-50">
                    {formatUsdPrecise(schedule.initialRou)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] tracking-widest text-zinc-500 uppercase">
                    Opening liability
                  </p>
                  <p className="font-medium tracking-tight text-zinc-50">
                    {formatUsdPrecise(schedule.initialLiability)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] tracking-widest text-zinc-500 uppercase">
                    IDC / prepaid / incentives
                  </p>
                  <p className="font-medium tracking-tight text-zinc-50">
                    {formatUsdPrecise(schedule.initialDirectCosts)} /{" "}
                    {formatUsdPrecise(schedule.prepaidRent)} /{" "}
                    {formatUsdPrecise(schedule.leaseIncentives)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] tracking-widest text-zinc-500 uppercase">
                    P&amp;L ({schedule.presentation})
                  </p>
                  <p className="font-medium tracking-tight text-zinc-50">
                    {formatUsdPrecise(
                      schedule.presentation === "operating"
                        ? schedule.operatingExpenseTotal
                        : schedule.financeExpenseTotal
                    )}
                  </p>
                </div>
              </div>

              <div className="max-h-[28rem] overflow-auto rounded-2xl border border-zinc-800/80">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-950">
                    <tr className="text-left text-[11px] tracking-widest text-zinc-400 uppercase">
                      <th className="px-4 py-3 font-medium">Period</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Interest</th>
                      <th className="px-4 py-3 font-medium">Principal</th>
                      <th className="px-4 py-3 font-medium">Liability</th>
                      <th className="px-4 py-3 font-medium">Amortization</th>
                      <th className="px-4 py-3 font-medium">ROU asset</th>
                      <th className="px-4 py-3 font-medium">Period expense</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {schedule.rows.map((row) => (
                      <tr key={row.period} className="hover:bg-zinc-900/40">
                        <td className="px-4 py-2 font-medium tracking-tight text-zinc-50">
                          {row.period}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-zinc-400">
                          {formatDate(row.dateIso)}
                        </td>
                        <td className="px-4 py-2 text-zinc-200">
                          {formatUsdPrecise(row.payment)}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">
                          {formatUsdPrecise(row.interest)}
                        </td>
                        <td className="px-4 py-2 text-zinc-200">
                          {formatUsdPrecise(row.principal)}
                        </td>
                        <td className="px-4 py-2 text-zinc-200">
                          {formatUsdPrecise(row.endingLiability)}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">
                          {formatUsdPrecise(row.depreciation)}
                        </td>
                        <td className="px-4 py-2 text-zinc-200">
                          {formatUsdPrecise(row.endingRou)}
                        </td>
                        <td className="px-4 py-2 text-zinc-200">
                          {formatUsdPrecise(row.periodExpense)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

const AccountingInputsForm = ({ term }: { term: LeasePaymentTerm }) => {
  const [state, action, isPending] = useActionState(
    updateLeaseAccountingInputs,
    null
  )
  const [presentation, setPresentation] = useState<LeasePresentation>(
    term.accounting.presentation
  )

  return (
    <form
      action={action}
      className="mb-5 grid gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <input type="hidden" name="lease_id" value={term.leaseId} />
      <label className="flex flex-col gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        IBR %
        <Input
          name="ibr_pct"
          type="number"
          min="0"
          max="40"
          step="0.05"
          defaultValue={(term.accounting.incrementalBorrowingRate * 100).toFixed(2)}
          className="h-10 rounded-xl border-zinc-800/80 bg-zinc-900/60 text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        Initial direct costs
        <Input
          name="initial_direct_costs"
          type="number"
          min="0"
          step="0.01"
          defaultValue={term.accounting.initialDirectCosts}
          className="h-10 rounded-xl border-zinc-800/80 bg-zinc-900/60 text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        Prepaid rent
        <Input
          name="prepaid_rent"
          type="number"
          min="0"
          step="0.01"
          defaultValue={term.accounting.prepaidRent}
          className="h-10 rounded-xl border-zinc-800/80 bg-zinc-900/60 text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        Incentives
        <Input
          name="lease_incentives"
          type="number"
          min="0"
          step="0.01"
          defaultValue={term.accounting.leaseIncentives}
          className="h-10 rounded-xl border-zinc-800/80 bg-zinc-900/60 text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        Presentation
        <select
          name="presentation"
          value={presentation}
          onChange={(event) =>
            setPresentation(event.target.value as LeasePresentation)
          }
          className="h-10 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-2 text-sm text-zinc-50"
        >
          <option value="finance">Finance</option>
          <option value="operating">Operating</option>
        </select>
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save inputs"}
        </Button>
      </div>
      {state && !state.ok ? (
        <p className="sm:col-span-2 lg:col-span-6 text-sm text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
