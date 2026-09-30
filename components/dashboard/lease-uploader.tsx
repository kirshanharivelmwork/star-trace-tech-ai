"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useObject } from "@ai-sdk/react"
import type { DeepPartial } from "ai"
import { useDropzone, type FileRejection } from "react-dropzone"
import {
  AlertCircle,
  Loader2,
  LogIn,
  Sparkles,
  UploadCloud,
} from "lucide-react"

import { useUser } from "@/components/providers/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FREE_LEASE_ABSTRACT_LIMIT } from "@/lib/stripe/constants"
import { createClient } from "@/lib/supabase/client"
import {
  leaseAbstractSchema,
  type LeaseAbstract,
  type LeaseAnalysisInput,
} from "@/app/api/lease/schema"

const LEASES_BUCKET = "leases"
const PRO_STATUSES = new Set(["active", "trialing"])

type UsageState = {
  isLoading: boolean
  isPro: boolean
  usedCount: number
}

const IDLE_USAGE_STATE: UsageState = {
  isLoading: true,
  isPro: false,
  usedCount: 0,
}

export type LeaseAnalysisState = {
  fileName: string | null
  object: DeepPartial<LeaseAbstract> | undefined
  isLoading: boolean
  error: string | null
}

type LeaseUploaderProps = {
  /**
   * Called whenever the live analysis state changes (including partial,
   * streamed data). Optional so this component doesn't crash if a caller
   * renders it without wiring up the workspace state.
   */
  onStateChange?: (state: LeaseAnalysisState) => void
  /** Called once a lease has been fully analyzed and persisted server-side. */
  onAnalysisComplete?: (result: {
    fileName: string
    storagePath: string
    abstract: LeaseAbstract
  }) => void
}

/**
 * Reads a File as a base64 `data:` URL, then strips the `data:...;base64,`
 * prefix so we can send the pure base64 payload straight to /api/lease as an
 * inline AI SDK file part, instead of depending on a Supabase Storage URL
 * being reachable by Anthropic's servers.
 */
const readFileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the file as a data URL."))
        return
      }
      const commaIndex = reader.result.indexOf(",")
      resolve(
        commaIndex === -1 ? reader.result : reader.result.slice(commaIndex + 1)
      )
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read the file."))
    reader.readAsDataURL(file)
  })

type UploadPhase = "idle" | "uploading" | "error"

export const LeaseUploader = ({
  onStateChange,
  onAnalysisComplete,
}: LeaseUploaderProps) => {
  const { user, isLoading: isUserLoading } = useUser()
  const [phase, setPhase] = useState<UploadPhase>("idle")
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageState>(IDLE_USAGE_STATE)
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] =
    useState(false)

  // Billing gate (UX only — app/api/lease/route.ts enforces this
  // authoritatively). Re-run after every completed analysis so the count
  // updates live without a page reload.
  const refreshUsage = useCallback(async () => {
    if (!user) {
      setUsage({ isLoading: false, isPro: false, usedCount: 0 })
      return
    }

    setUsage((previous) => ({ ...previous, isLoading: true }))

    const supabase = createClient()
    const [{ count }, { data: subscriptionRow }] = await Promise.all([
      supabase
        .from("lease_abstracts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle<{ status: string }>(),
    ])

    setUsage({
      isLoading: false,
      isPro: Boolean(subscriptionRow && PRO_STATUSES.has(subscriptionRow.status)),
      usedCount: count ?? 0,
    })
  }, [user])

  useEffect(() => {
    refreshUsage()
  }, [refreshUsage])

  // Remembers the Storage path of the file currently being (or just)
  // analyzed, so it can be attached to the persisted lease_abstracts row
  // once the streamObject call finishes on the server.
  const storagePathRef = useRef<string>("")

  const { object, submit, isLoading, error } = useObject<
    typeof leaseAbstractSchema,
    LeaseAbstract,
    LeaseAnalysisInput
  >({
    api: "/api/lease",
    schema: leaseAbstractSchema,
    onFinish: ({ object: finalObject }) => {
      if (finalObject && fileName) {
        onAnalysisComplete?.({
          fileName,
          storagePath: storagePathRef.current,
          abstract: finalObject,
        })
        // A successful analysis just consumed one free-tier slot (if the
        // user isn't Pro) — refresh so the gate re-evaluates immediately.
        refreshUsage()
      }
    },
  })

  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        fileName,
        object,
        isLoading,
        error: error?.message ?? null,
      })
    }
    // `onStateChange` should be a stable callback (e.g. wrapped in
    // useCallback) from the parent; it's safe to include here.
  }, [fileName, object, isLoading, error, onStateChange])

  const isBusy = phase === "uploading" || isLoading
  const isSignedOut = !isUserLoading && !user

  // Proactive (pre-upload) gate, derived from the count/subscription we
  // fetched client-side — UX only, app/api/lease/route.ts is the
  // authoritative check.
  const hasReachedFreeLimit =
    !usage.isLoading && !usage.isPro && usage.usedCount >= FREE_LEASE_ABSTRACT_LIMIT

  // Reactive fallback: if the client-side gate was stale (e.g. a second
  // tab already used the last free slot) and the server rejected the
  // request with its 402, surface the exact same upgrade prompt instead of
  // a generic error.
  const quotaErrorMessage =
    error?.message?.includes("Upgrade to Pro") ? error.message : null

  const showUpgradePrompt = hasReachedFreeLimit || Boolean(quotaErrorMessage)

  const handleUpgrade = useCallback(async () => {
    setIsRedirectingToCheckout(true)
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST" })

      if (!response.ok) {
        throw new Error(
          (await response.text()) || "Failed to start checkout."
        )
      }

      const { url } = (await response.json()) as { url: string }
      window.location.href = url
    } catch (checkoutError) {
      setPhase("error")
      setUploadError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Failed to start checkout. Please try again."
      )
      setIsRedirectingToCheckout(false)
    }
  }, [])

  const onDrop = useCallback(
    async (acceptedFiles: File[], rejections: FileRejection[]) => {
      if (!user) {
        setPhase("error")
        setUploadError("Please sign in to analyze a lease.")
        return
      }

      if (hasReachedFreeLimit) {
        setPhase("error")
        setUploadError(
          `You've used all ${FREE_LEASE_ABSTRACT_LIMIT} free lease abstracts. Upgrade to Pro to continue.`
        )
        return
      }

      if (rejections.length > 0) {
        setPhase("error")
        setUploadError("Only a single PDF file is accepted.")
        return
      }

      const file = acceptedFiles[0]
      if (!file) return

      setPhase("uploading")
      setUploadError(null)
      setFileName(file.name)

      try {
        // Read the PDF as base64 up front — this is what actually gets sent
        // to Claude, so analysis doesn't depend on the Supabase upload.
        const fileBase64 = await readFileAsBase64(file)

        // Still persist the original file in Supabase Storage for record
        // keeping / auditing, and to link it from the lease_abstracts row.
        const supabase = createClient()
        const storagePath = `${crypto.randomUUID()}-${file.name}`

        const { error: uploadStorageError } = await supabase.storage
          .from(LEASES_BUCKET)
          .upload(storagePath, file, { contentType: "application/pdf" })

        if (uploadStorageError) {
          console.error(
            "[LeaseUploader] Supabase upload failed:",
            uploadStorageError.message
          )
        }

        storagePathRef.current = storagePath
        setPhase("idle")

        submit({ fileName: file.name, storagePath, fileBase64 })
      } catch (caughtError) {
        setPhase("error")
        setUploadError(
          caughtError instanceof Error
            ? caughtError.message
            : "Upload failed. Please try again."
        )
      }
    },
    [submit, user, hasReachedFreeLimit]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled: isBusy || isSignedOut || showUpgradePrompt,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lease Abstractor</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          {...getRootProps()}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition-all",
            isDragActive
              ? "border-violet-400/60 bg-violet-500/10 shadow-[0_0_32px_-12px_var(--glow-primary)]"
              : "border-zinc-700/80",
            isBusy || isSignedOut || showUpgradePrompt
              ? "pointer-events-none opacity-60"
              : "hover:border-violet-400/40 hover:bg-zinc-950/40 hover:shadow-[0_0_24px_-12px_var(--glow-primary)]",
          ].join(" ")}
        >
          <input {...getInputProps()} />

          {isSignedOut ? (
            <>
              <LogIn className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Sign in to analyze a lease</p>
              <p className="text-xs text-muted-foreground">
                Use the sign in button in the header above
              </p>
            </>
          ) : showUpgradePrompt ? (
            <>
              <Sparkles className="size-6 text-amber-500" />
              <p className="text-sm font-medium">
                You&apos;ve used all {FREE_LEASE_ABSTRACT_LIMIT} free lease
                abstracts
              </p>
              <p className="text-xs text-muted-foreground">
                Upgrade to Pro for unlimited lease abstracts
              </p>
              <Button
                type="button"
                size="sm"
                className="pointer-events-auto mt-1"
                onClick={(event) => {
                  event.stopPropagation()
                  handleUpgrade()
                }}
                disabled={isRedirectingToCheckout}
              >
                {isRedirectingToCheckout ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Upgrade to Pro
              </Button>
            </>
          ) : phase === "uploading" ? (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Uploading {fileName}…
              </p>
            </>
          ) : isLoading ? (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Analyzing {fileName ?? "lease"}…
              </p>
            </>
          ) : (
            <>
              <UploadCloud className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drop a lease PDF here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                PDF only · analyzed automatically by Claude
              </p>
            </>
          )}
        </div>

        {!usage.isLoading && !usage.isPro && !showUpgradePrompt && user ? (
          <p className="text-xs text-muted-foreground">
            {FREE_LEASE_ABSTRACT_LIMIT - usage.usedCount} of{" "}
            {FREE_LEASE_ABSTRACT_LIMIT} free lease abstracts remaining
          </p>
        ) : null}

        {phase === "error" && uploadError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
