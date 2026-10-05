/**
 * Server-side validation for POST /api/lease. The browser's dropzone checks
 * are UX only — everything here is re-verified on the server.
 */

import { MAX_FILE_NAME_LENGTH, MAX_LEASE_PDF_BYTES } from "@/lib/lease/limits"

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const PDF_MAGIC = "%PDF-"
// Control characters (incl. newlines) are never legitimate in a file name and
// would let a crafted name inject lines into the model prompt.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export type ValidatedLeaseUpload = {
  fileName: string
  storagePath: string
  fileBase64: string
}

export type LeaseValidationResult =
  | { ok: true; value: ValidatedLeaseUpload }
  | { ok: false; status: 400 | 413 | 415; message: string }

const fail = (
  status: 400 | 413 | 415,
  message: string
): LeaseValidationResult => ({ ok: false, status, message })

/** Storage objects must live under the caller's organization folder. */
export const buildStoragePathPattern = (orgId: string): RegExp =>
  new RegExp(`^${orgId}/[0-9a-fA-F-]{36}\\.pdf$`)

export const validateLeaseUpload = (
  input: unknown,
  orgId: string
): LeaseValidationResult => {
  if (!input || typeof input !== "object") {
    return fail(400, "Request body must be a JSON object.")
  }

  const { fileName, storagePath, fileBase64 } = input as Record<string, unknown>

  if (typeof fileName !== "string" || !fileName.trim()) {
    return fail(400, "Missing fileName.")
  }
  if (fileName.length > MAX_FILE_NAME_LENGTH || CONTROL_CHARS.test(fileName)) {
    return fail(400, "Invalid fileName.")
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return fail(415, "Only PDF files are supported.")
  }

  if (
    typeof storagePath !== "string" ||
    !buildStoragePathPattern(orgId).test(storagePath)
  ) {
    return fail(400, "Invalid storagePath.")
  }

  if (typeof fileBase64 !== "string" || fileBase64.length === 0) {
    return fail(400, "Missing file data.")
  }
  const maxBase64Length = Math.ceil((MAX_LEASE_PDF_BYTES * 4) / 3) + 4
  if (fileBase64.length > maxBase64Length) {
    return fail(413, "File is too large.")
  }
  if (fileBase64.length % 4 !== 0 || !BASE64_PATTERN.test(fileBase64)) {
    return fail(400, "File data is not valid base64.")
  }

  const bytes = Buffer.from(fileBase64, "base64")
  if (bytes.byteLength > MAX_LEASE_PDF_BYTES) {
    return fail(413, "File is too large.")
  }
  // Content check, not just the extension / client-claimed MIME type.
  if (bytes.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
    return fail(415, "The uploaded file is not a PDF.")
  }

  return { ok: true, value: { fileName, storagePath, fileBase64 } }
}
