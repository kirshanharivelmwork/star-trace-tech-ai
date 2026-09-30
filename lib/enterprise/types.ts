/**
 * Defensive row shapes for the live institutional schema, confirmed via
 * PostgREST column probes:
 *   notice_windows: id, lease_id, status, target_date, created_at
 *   operating_expenses: id, property_id, amount, expense_category, incurred_date, created_at
 *   tenant_cam_allocations: id, lease_id, expense_id, allocated_amount, status, created_at
 *   audit_logs: id, user_id, action, resource_type, details, ip_address, created_at
 */

export type NoticeWindowRow = {
  id: string
  lease_id: string | null
  status: string | null
  target_date: string | null
  created_at: string | null
}

export type OperatingExpenseRow = {
  id: string
  property_id: string | null
  amount: number | string | null
  expense_category: string | null
  incurred_date: string | null
  created_at: string | null
}

export type TenantCamAllocationRow = {
  id: string
  lease_id: string | null
  expense_id: string | null
  allocated_amount: number | string | null
  status: string | null
  created_at: string | null
}

export type AuditLogRow = {
  id: string
  user_id: string | null
  action: string | null
  resource_type: string | null
  details: unknown
  ip_address: string | null
  created_at: string | null
}

export type NoticePriority = "critical" | "high" | "watch"

export type NoticeAlert = {
  id: string
  leaseId: string | null
  tenantName: string
  propertyName: string | null
  status: string | null
  targetDate: Date | null
  daysUntil: number | null
  priority: NoticePriority
}

export type PropertyOption = {
  id: string
  name: string
  totalNra: number | null
}

export type ExpenseLedgerRow = {
  id: string
  propertyId: string | null
  propertyName: string | null
  amount: number | null
  category: string | null
  incurredDate: string | null
  createdAt: string | null
}

export type CamAllocationView = {
  id: string
  expenseId: string | null
  leaseId: string | null
  tenantName: string
  propertyName: string | null
  category: string | null
  allocatedAmount: number | null
  status: string | null
  createdAt: string | null
}

export type CamSnapshot = {
  properties: PropertyOption[]
  expenses: ExpenseLedgerRow[]
  allocations: CamAllocationView[]
}

export type LeasePaymentTerm = {
  leaseId: string
  tenantName: string
  propertyName: string | null
  monthlyPayment: number
  startDate: string | null
  endDate: string | null
  remainingMonths: number
}

export type AmortizationRow = {
  period: number
  dateIso: string
  payment: number
  interest: number
  principal: number
  endingLiability: number
  depreciation: number
  endingRou: number
}

export type LeaseDisclosureSchedule = {
  leaseId: string
  tenantName: string
  propertyName: string | null
  monthlyPayment: number
  remainingMonths: number
  annualRate: number
  initialLiability: number
  initialRou: number
  undiscountedRemaining: number
  rows: AmortizationRow[]
}
