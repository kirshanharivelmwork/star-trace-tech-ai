import { Skeleton } from "@/components/ui/skeleton"

const DashboardLoading = () => (
  <div
    className="flex flex-1 flex-col gap-6 p-6"
    role="status"
    aria-live="polite"
    aria-label="Loading"
  >
    <Skeleton className="h-8 w-56" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
    <Skeleton className="h-72 w-full" />
  </div>
)

export default DashboardLoading
