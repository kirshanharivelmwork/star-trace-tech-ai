/**
 * Kept in its own tiny, dependency-free module (no `stripe` import, no
 * service-role key) so it's safe to import from client components like
 * components/dashboard/lease-uploader.tsx without pulling server-only
 * billing code into the browser bundle.
 */

/** Number of lease abstracts a free (non-Pro) account may analyze before being gated. */
export const FREE_LEASE_ABSTRACT_LIMIT = 2
