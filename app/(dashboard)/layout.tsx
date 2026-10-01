import { requireOrgContext } from "@/lib/org/context"

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireOrgContext()
  return children
}
