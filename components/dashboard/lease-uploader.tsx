"use client"

import { useCallback, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useDropzone, type FileRejection } from "react-dropzone"
import {
  AlertCircle,
  FileText,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createClient } from "@/lib/supabase/client"

const LEASES_BUCKET = "leases"
const SIGNED_URL_TTL_SECONDS = 600

const ANALYSIS_PROMPT =
  "Analyze this commercial lease document and extract its key terms."

// Dedicated abstractor endpoint — kept separate from the general dashboard
// assistant's /api/chat so that endpoint's persona is unaffected.
const leaseTransport = new DefaultChatTransport({ api: "/api/lease" })

type UploadPhase = "idle" | "uploading" | "error"

export const LeaseUploader = () => {
  const [phase, setPhase] = useState<UploadPhase>("idle")
  const [fileName, setFileName] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { messages, sendMessage, status } = useChat({ transport: leaseTransport })

  const isAnalyzing = status === "submitted" || status === "streaming"
  const isBusy = phase === "uploading" || isAnalyzing

  const analysisText = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("")

  const reset = () => {
    setPhase("idle")
    setFileName(null)
    setErrorMessage(null)
  }

  const onDrop = useCallback(
    async (acceptedFiles: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        setPhase("error")
        setErrorMessage("Only a single PDF file is accepted.")
        return
      }

      const file = acceptedFiles[0]
      if (!file) return

      setPhase("uploading")
      setErrorMessage(null)
      setFileName(file.name)

      try {
        const supabase = createClient()
        const path = `${crypto.randomUUID()}-${file.name}`

        const { error: uploadError } = await supabase.storage
          .from(LEASES_BUCKET)
          .upload(path, file, { contentType: "application/pdf" })

        if (uploadError) {
          throw new Error(uploadError.message)
        }

        const { data: signedUrlData, error: signedUrlError } =
          await supabase.storage
            .from(LEASES_BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

        if (signedUrlError || !signedUrlData) {
          throw new Error(signedUrlError?.message ?? "Could not get a signed URL for the uploaded file.")
        }

        setPhase("idle")

        sendMessage({
          text: ANALYSIS_PROMPT,
          files: [
            {
              type: "file",
              filename: file.name,
              mediaType: "application/pdf",
              url: signedUrlData.signedUrl,
            },
          ],
        })
      } catch (error) {
        setPhase("error")
        setErrorMessage(
          error instanceof Error ? error.message : "Upload failed. Please try again."
        )
      }
    },
    [sendMessage]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled: isBusy,
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
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
            isDragActive ? "border-primary bg-primary/5" : "border-border",
            isBusy ? "pointer-events-none opacity-60" : "hover:border-primary/60 hover:bg-muted/40",
          ].join(" ")}
        >
          <input {...getInputProps()} />

          {phase === "uploading" ? (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading {fileName}…</p>
            </>
          ) : isAnalyzing ? (
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

        {phase === "error" && errorMessage ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={reset}>
              <X className="size-3.5" />
              <span className="sr-only">Dismiss</span>
            </Button>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>Analysis failed. Please try uploading the lease again.</span>
          </div>
        ) : null}

        {fileName && !errorMessage ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="size-3.5" />
            <span className="truncate">{fileName}</span>
          </div>
        ) : null}

        {analysisText ? (
          <ScrollArea className="h-64 rounded-lg border bg-muted/30 p-3">
            <p className="whitespace-pre-wrap text-sm text-foreground">{analysisText}</p>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  )
}
