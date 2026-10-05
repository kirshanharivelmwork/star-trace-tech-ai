import Link from "next/link"

import { Button } from "@/components/ui/button"

const NotFoundPage = () => (
  <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 className="text-xl font-semibold">Page not found</h1>
    <p className="max-w-md text-sm text-muted-foreground">
      The page you are looking for does not exist or you do not have access to
      it.
    </p>
    <Button render={<Link href="/" />} nativeButton={false}>
      Go home
    </Button>
  </main>
)

export default NotFoundPage
