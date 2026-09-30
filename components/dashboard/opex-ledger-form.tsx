"use client"

import { useActionState } from "react"

import {
  logOperatingExpense,
  type OpexActionState,
} from "@/app/finances/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PropertyOption } from "@/lib/enterprise/types"

const FIELD =
  "h-11 rounded-2xl border-zinc-800/80 bg-zinc-900/60 px-3.5 text-zinc-50 shadow-2xl backdrop-blur-xl placeholder:text-zinc-500"

const CATEGORIES = [
  "CAM",
  "Utilities",
  "Insurance",
  "Real estate taxes",
  "Repairs & maintenance",
  "Property management",
  "Security",
  "Other",
] as const

type OpexLedgerFormProps = {
  properties: PropertyOption[]
}

export const OpexLedgerForm = ({ properties }: OpexLedgerFormProps) => {
  const [state, formAction, pending] = useActionState<OpexActionState, FormData>(
    logOperatingExpense,
    null
  )

  const today = new Date().toISOString().slice(0, 10)

  if (properties.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        Add a property before logging building expenses. CAM allocations are
        prorated from lease square footage against property NRA.
      </p>
    )
  }

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="opex-property" className="text-xs font-medium tracking-wide text-zinc-400">
          Property
        </label>
        <select
          id="opex-property"
          name="property_id"
          required
          disabled={pending}
          className={`${FIELD} appearance-none`}
          defaultValue=""
        >
          <option value="" disabled>
            Select an asset
          </option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="opex-category" className="text-xs font-medium tracking-wide text-zinc-400">
          Category
        </label>
        <select
          id="opex-category"
          name="expense_category"
          required
          disabled={pending}
          className={`${FIELD} appearance-none`}
          defaultValue="CAM"
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="opex-amount" className="text-xs font-medium tracking-wide text-zinc-400">
          Amount (USD)
        </label>
        <Input
          id="opex-amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          disabled={pending}
          placeholder="0.00"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="opex-date" className="text-xs font-medium tracking-wide text-zinc-400">
          Incurred date
        </label>
        <Input
          id="opex-date"
          name="incurred_date"
          type="date"
          required
          defaultValue={today}
          disabled={pending}
          className={FIELD}
        />
      </div>

      <div className="flex items-end md:col-span-2 xl:col-span-4">
        <Button type="submit" disabled={pending} className="h-11 rounded-2xl">
          {pending ? "Allocating…" : "Log expense & allocate CAM"}
        </Button>
      </div>

      {state?.ok ? (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 md:col-span-2 xl:col-span-4">
          Expense posted. Prorated across {state.allocated}{" "}
          {state.allocated === 1 ? "lease" : "leases"}.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 md:col-span-2 xl:col-span-4">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
