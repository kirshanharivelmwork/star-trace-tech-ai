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

import { useOrg } from "@/components/providers/org-provider"
import { useUser } from "@/components/providers/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { openBillingPortal } from "@/lib/org/actions"
import { MAX_LEASE_PDF_BYTES } from "@/lib/lease/limits"
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

const SIGNED_OUT_USAGE_STATE: UsageState = {
  isLoading: false,
  isPro: false,
  usedCount: 0,
}

const LOADING_USAGE_STATE: UsageState = {
  isLoading: true,
  isPro: false,
  usedCount: 0,
}

/** Usage result tagged with the org it was fetched for. */
type FetchedUsage = { orgId: string; isPro: boolean; usedCount: number }

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

const fetchUsage = async (orgId: string): Promise<FetchedUsage> => {
  const supabase = createClient()
  const [{ count }, { data: subscriptionRow }] = await Promise.all([
    supabase
      .from("lease_abstracts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("subscriptions")
      .select("status")
      .eq("organization_id", orgId)
      .maybeSingle<{ status: string }>(),
  ])

  return {
    orgId,
    isPro: Boolean(subscriptionRow && PRO_STATUSES.has(subscriptionRow.status)),
    usedCount: count ?? 0,
  }
}

export const LeaseUploader = ({
  onStateChange,
  onAnalysisComplete,
}: LeaseUploaderProps) => {
  const { user, isLoading: isUserLoading } = useUser()
  const org = useOrg()
  const [phase, setPhase] = useState<UploadPhase>("idle")
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [fetchedUsage, setFetchedUsage] = useState<FetchedUsage | null>(null)
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] =
    useState(false)

  // Billing gate (UX only — app/api/lease/route.ts enforces this
  // authoritatively). Re-run after every completed analysis so the count
  // updates live without a page reload.
  const orgId = org?.orgId
  const hasUsageScope = Boolean(user && orgId)
  // Derived at render time: signed-out, still loading (nothing fetched for
  // the current org yet), or the fetched result.
  const usage: UsageState = !hasUsageScope
    ? SIGNED_OUT_USAGE_STATE
    : fetchedUsage && fetchedUsage.orgId === orgId
      ? {
          isLoading: false,
          isPro: fetchedUsage.isPro,
          usedCount: fetchedUsage.usedCount,
        }
      : LOADING_USAGE_STATE

  const refreshUsage = useCallback(async () => {
    if (!user || !orgId) return
    setFetchedUsage(await fetchUsage(orgId))
  }, [user, orgId])

  useEffect(() => {
    if (!user || !orgId) return

    let isCancelled = false
    fetchUsage(orgId).then((result) => {
      if (!isCancelled) setFetchedUsage(result)
    })

    return () => {
      isCancelled = true
    }
  }, [user, orgId])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("checkout") !== "success") return
    const timer = window.setTimeout(() => {
      refreshUsage()
    }, 800)
    return () => window.clearTimeout(timer)
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
      if (!user || !orgId) {
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
        const tooLarge = rejections.some((rejection) =>
          rejection.errors.some((error) => error.code === "file-too-large")
        )
        setPhase("error")
        setUploadError(
          tooLarge
            ? `That PDF is too large. The maximum size is ${(MAX_LEASE_PDF_BYTES / 1_000_000).toFixed(1)} MB.`
            : "Only a single PDF file is accepted."
        )
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
        // Must be `<orgId>/<uuid>.pdf`: the private `leases` bucket policy and
        // /api/lease both scope objects by the first path segment.
        const storagePath = `${orgId}/${crypto.randomUUID()}.pdf`

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
    [submit, user, orgId, hasReachedFreeLimit]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_LEASE_PDF_BYTES,
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
              ? "border-pink-300/60 bg-pink-400/10 shadow-[0_0_32px_-12px_var(--glow-primary)]"
              : "border-zinc-700/80",
            isBusy || isSignedOut || showUpgradePrompt
              ? "pointer-events-none opacity-60"
              : "hover:border-pink-300/40 hover:bg-zinc-950/40 hover:shadow-[0_0_24px_-12px_var(--glow-primary)]",
          ].join(" ")}
        >
          <input {...getInputProps()} />

          {isSignedOut ? (
            <>
              <LogIn className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Sign in to analyze a lease</p>
              <p className="text-xs text-muted-foreground">
                Sign in from the login page to analyze a lease
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
              <form
                action={openBillingPortal}
                className="pointer-events-auto"
                onClick={(event) => event.stopPropagation()}
              >
                <Button type="submit" size="sm" variant="outline">
                  Manage billing
                </Button>
              </form>
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
