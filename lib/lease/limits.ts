/**
 * Upload limits shared by the browser (UX pre-check) and the server
 * (authoritative check in lib/lease/validate.ts). Dependency-free so client
 * components can import it.
 */

/**
 * Largest PDF accepted, in bytes. The file is sent as base64 inside a JSON
 * body (+33%), and Vercel Functions reject request bodies over 4.5 MB, so
 * ~3.3 MB of raw PDF is the most that can reach /api/lease in production.
 */
export const MAX_LEASE_PDF_BYTES = 3_300_000

/** Base64 length of MAX_LEASE_PDF_BYTES, plus slack for the JSON envelope. */
export const MAX_LEASE_REQUEST_BYTES =
  Math.ceil((MAX_LEASE_PDF_BYTES * 4) / 3) + 4096

export const MAX_FILE_NAME_LENGTH = 255
