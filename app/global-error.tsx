"use client"

import { useEffect } from "react"

type GlobalErrorProps = {
  error: Error & { digest?: string }
  retry: () => void
}

// Replaces the root layout when it fails, so it renders its own <html>/<body>
// and cannot rely on Tailwind or the app's providers. Inline styles only.
const GlobalError = ({ error, retry }: GlobalErrorProps) => {
  useEffect(() => {
    console.error("[global error]", error.digest ?? error.message)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#09090b",
          color: "#fafafa",
        }}
      >
        <title>StarFlow: something went wrong</title>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: 420, fontSize: 14, color: "#a1a1aa", margin: 0 }}>
          StarFlow hit an unexpected error. Your data has not been changed.
          {error.digest ? ` Reference: ${error.digest}.` : ""}
        </p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #3f3f46",
            background: "#fafafa",
            color: "#09090b",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}

export default GlobalError
