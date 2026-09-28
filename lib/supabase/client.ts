import { createBrowserClient } from "@supabase/ssr"

/**
 * Supabase client for use in Client Components. Cookie storage is handled
 * automatically by @supabase/ssr — do not pass a custom `cookies` option
 * unless you have a specific reason to override the default behavior.
 */
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
