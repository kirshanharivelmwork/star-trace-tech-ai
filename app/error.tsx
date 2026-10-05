"use client"

import { useEffect } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

type ErrorPageProps = {
  error: Error & { digest?: string }
  retry: () => void
}

const ErrorPage = ({ error, retry }: ErrorPageProps) => {
  useEffect(() => {
    // The digest matches the server-side log line for this failure; the message
    // is intentionally generic in production.
    console.error("[app error]", error.digest ?? error.message)
  }, [error])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        We hit an unexpected error loading this page. Your data has not been
        changed. Try again, and if it keeps happening contact support
        {error.digest ? ` with reference ${error.digest}` : ""}.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button
          variant="outline"
          render={<Link href="/" />}
          nativeButton={false}
        >
          Go home
        </Button>
      </div>
    </main>
  )
}

export default ErrorPage
