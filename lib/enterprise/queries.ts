import {
  calendarDaysUntil,
  classifyNoticePriority,
  parseIsoDate,
  remainingWholeMonths,
  toMoney,
} from "@/lib/enterprise/metrics"
import { defaultAccountingInputs } from "@/lib/enterprise/asc842"
import type {
  AuditLogRow,
  CamAllocationView,
  CamSnapshot,
  ExpenseLedgerRow,
  LeasePaymentTerm,
  LeasePresentation,
  NoticeAlert,
  NoticeWindowRow,
  OperatingExpenseRow,
  PropertyOption,
  TenantCamAllocationRow,
} from "@/lib/enterprise/types"
import { isActiveLease, toNumber } from "@/lib/telemetry/metrics"
import type { LeaseRow, PropertyRow } from "@/lib/telemetry/types"
import { createClient } from "@/lib/supabase/server"

const LEASE_SELECT =
  "id, property_id, tenant_name, status, start_date, end_date, square_footage, monthly_rent, created_at, incremental_borrowing_rate, initial_direct_costs, prepaid_rent, lease_incentives, accounting_presentation, needs_review"

export const loadOwnedPortfolio = async (organizationId: string) => {
  const supabase = await createClient()

  const { data: propertyData, error: propertyError } = await supabase
    .from("properties")
    .select("id, user_id, organization_id, name, address, valuation, total_nra, created_at")
    .eq("organization_id", organizationId)

  if (propertyError) {
    console.error("[enterprise] properties:", propertyError.message)
  }

  const properties = (propertyData ?? []) as PropertyRow[]
  const propertyIds = properties.map((property) => property.id)
  const propertyById = new Map(properties.map((property) => [property.id, property]))

  let leases: LeaseRow[] = []
  if (propertyIds.length > 0) {
    const { data: leaseData, error: leaseError } = await supabase
      .from("leases")
      .select(LEASE_SELECT)
      .in("property_id", propertyIds)

    if (leaseError) {
      console.error("[enterprise] leases:", leaseError.message)
    } else {
      leases = (leaseData ?? []) as LeaseRow[]
    }
  }

  return { supabase, properties, propertyIds, propertyById, leases }
}

export const fetchNoticeAlerts = async (
  organizationId: string,
  now: Date = new Date()
): Promise<NoticeAlert[]> => {
  const { supabase, propertyById, leases } = await loadOwnedPortfolio(organizationId)
  const leaseIds = leases.map((lease) => lease.id)
  if (leaseIds.length === 0) return []

  const { data, error } = await supabase
    .from("notice_windows")
    .select("id, lease_id, status, target_date, created_at, label, notice_days")
    .in("lease_id", leaseIds)

  if (error) {
    console.error("[enterprise] notice_windows:", error.message)
    return []
  }

  const leaseById = new Map(leases.map((lease) => [lease.id, lease]))
  const windows = (data ?? []) as NoticeWindowRow[]

  const alerts: NoticeAlert[] = windows.map((window) => {
    const lease = window.lease_id ? leaseById.get(window.lease_id) : undefined
    const property = lease?.property_id
      ? propertyById.get(lease.property_id)
      : undefined
    const targetDate = parseIsoDate(window.target_date)
    const daysUntil = targetDate ? calendarDaysUntil(targetDate, now) : null
    const priority =
      daysUntil == null ? "watch" : classifyNoticePriority(daysUntil)

    return {
      id: window.id,
      leaseId: window.lease_id,
      tenantName: lease?.tenant_name?.trim() || "Unnamed tenant",
      propertyName: property?.name ?? null,
      status: window.status,
      targetDate,
      daysUntil,
      priority,
    }
  })

  alerts.sort((a, b) => {
    const rank = { critical: 0, high: 1, watch: 2 }
    const byPriority = rank[a.priority] - rank[b.priority]
    if (byPriority !== 0) return byPriority
    return (a.daysUntil ?? 99999) - (b.daysUntil ?? 99999)
  })

  return alerts
}

export const fetchCamSnapshot = async (
  organizationId: string
): Promise<CamSnapshot> => {
  const { supabase, properties, propertyIds, propertyById, leases } =
    await loadOwnedPortfolio(organizationId)

  const propertyOptions: PropertyOption[] = properties.map((property) => ({
    id: property.id,
    name: property.name?.trim() || "Untitled asset",
    totalNra: toNumber(property.total_nra),
  }))

  let expenses: ExpenseLedgerRow[] = []
  if (propertyIds.length > 0) {
    const { data, error } = await supabase
      .from("operating_expenses")
      .select("id, property_id, amount, expense_category, incurred_date, created_at")
      .in("property_id", propertyIds)
      .order("incurred_date", { ascending: false })

    if (error) {
      console.error("[enterprise] operating_expenses:", error.message)
    } else {
      expenses = ((data ?? []) as OperatingExpenseRow[]).map((row) => {
        const property = row.property_id ? propertyById.get(row.property_id) : undefined
        return {
          id: row.id,
          propertyId: row.property_id,
          propertyName: property?.name ?? null,
          amount: toMoney(row.amount),
          category: row.expense_category,
          incurredDate: row.incurred_date,
          createdAt: row.created_at,
        }
      })
    }
  }

  const leaseIds = leases.map((lease) => lease.id)
  const leaseById = new Map(leases.map((lease) => [lease.id, lease]))
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]))

  let allocations: CamAllocationView[] = []
  if (leaseIds.length > 0) {
    const { data, error } = await supabase
      .from("tenant_cam_allocations")
      .select("id, lease_id, expense_id, allocated_amount, status, created_at")
      .in("lease_id", leaseIds)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[enterprise] tenant_cam_allocations:", error.message)
    } else {
      allocations = ((data ?? []) as TenantCamAllocationRow[]).map((row) => {
        const lease = row.lease_id ? leaseById.get(row.lease_id) : undefined
        const property = lease?.property_id
          ? propertyById.get(lease.property_id)
          : undefined
        const expense = row.expense_id ? expenseById.get(row.expense_id) : undefined
        return {
          id: row.id,
          expenseId: row.expense_id,
          leaseId: row.lease_id,
          tenantName: lease?.tenant_name?.trim() || "Unnamed tenant",
          propertyName: property?.name ?? null,
          category: expense?.category ?? null,
          allocatedAmount: toMoney(row.allocated_amount),
          status: row.status,
          createdAt: row.created_at,
        }
      })
    }
  }

  return { properties: propertyOptions, expenses, allocations }
}

const asPresentation = (value: string | null | undefined): LeasePresentation =>
  value === "operating" ? "operating" : "finance"

export const fetchLeasePaymentTerms = async (
  organizationId: string,
  now: Date = new Date()
): Promise<LeasePaymentTerm[]> => {
  const { propertyById, leases } = await loadOwnedPortfolio(organizationId)

  return leases
    .filter((lease) => isActiveLease(lease, now))
    .map((lease) => {
      const property = lease.property_id
        ? propertyById.get(lease.property_id)
        : undefined
      const end = parseIsoDate(lease.end_date)
      const monthlyPayment = toMoney(lease.monthly_rent) ?? 0
      const rate = toNumber(lease.incremental_borrowing_rate)
      return {
        leaseId: lease.id,
        tenantName: lease?.tenant_name?.trim() || "Unnamed tenant",
        propertyName: property?.name ?? null,
        monthlyPayment,
        startDate: lease.start_date,
        endDate: lease.end_date,
        remainingMonths: end ? remainingWholeMonths(end, now) : 0,
        accounting: defaultAccountingInputs({
          incrementalBorrowingRate: rate ?? 0.05,
          initialDirectCosts: toMoney(lease.initial_direct_costs) ?? 0,
          prepaidRent: toMoney(lease.prepaid_rent) ?? 0,
          leaseIncentives: toMoney(lease.lease_incentives) ?? 0,
          presentation: asPresentation(lease.accounting_presentation),
        }),
      }
    })
    .filter((term) => term.monthlyPayment > 0 && term.remainingMonths > 0)
}

export const fetchAuditLogs = async (
  organizationId: string
): Promise<AuditLogRow[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, user_id, organization_id, action, resource_type, details, ip_address, created_at"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    console.error("[enterprise] audit_logs:", error.message)
    return []
  }

  return (data ?? []) as AuditLogRow[]
}
