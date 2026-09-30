"use client"

import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildPortfolioDisclosure } from "@/lib/enterprise/asc842"
import type { LeasePaymentTerm } from "@/lib/enterprise/types"

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
}

export const ComplianceBoard = ({ terms }: ComplianceBoardProps) => {
  const [ratePct, setRatePct] = useState("5.00")
  const annualRate = Math.max(0, Number.parseFloat(ratePct) || 0) / 100

  const schedules = useMemo(
    () => buildPortfolioDisclosure(terms, annualRate),
    [terms, annualRate]
  )

  const totals = schedules.reduce(
    (acc, schedule) => {
      acc.rou += schedule.initialRou
      acc.liability += schedule.initialLiability
      acc.undiscounted += schedule.undiscountedRemaining
      return acc
    },
    { rou: 0, liability: 0, undiscounted: 0 }
  )

  if (terms.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-400">
          No in-place leases with remaining rent — ASC 842 schedules need
          monthly_rent and a future end_date.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-end justify-between space-y-0">
          <div>
            <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
              Incremental borrowing rate
            </CardTitle>
            <p className="text-xs text-zinc-400">
              Monthly PV of remaining payments; ROU depreciates straight-line.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              max="40"
              step="0.25"
              value={ratePct}
              onChange={(event) => setRatePct(event.target.value)}
              className="h-11 w-28 rounded-2xl border-zinc-800/80 bg-zinc-900/60 text-zinc-50 backdrop-blur-xl"
            />
            <span className="text-xs tracking-wide text-zinc-400">% IBR</span>
          </div>
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

      {schedules.map((schedule) => (
        <Card key={schedule.leaseId}>
          <CardHeader>
            <CardTitle className="text-sm font-medium tracking-tight text-zinc-50">
              {schedule.tenantName}
            </CardTitle>
            <p className="text-xs text-zinc-400">
              {schedule.propertyName ?? "Unassigned asset"} ·{" "}
              {schedule.remainingMonths} remaining months ·{" "}
              {formatUsdPrecise(schedule.monthlyPayment)}/mo · IBR{" "}
              {(schedule.annualRate * 100).toFixed(2)}%
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
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
                  Undiscounted
                </p>
                <p className="font-medium tracking-tight text-zinc-50">
                  {formatUsdPrecise(schedule.undiscountedRemaining)}
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
                    <th className="px-4 py-3 font-medium">Depreciation</th>
                    <th className="px-4 py-3 font-medium">ROU asset</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
