import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

// Magic-link sign-in redirects here with a PKCE `code` param (see
// UserMenu's `signInWithOtp` call). Exchanging it for a session sets the
// auth cookies via lib/supabase/server.ts's `setAll`, then we redirect back
// into the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const redirectTo = searchParams.get("redirect_to") ?? "/"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`)
    }

    console.error("[Auth Callback Error]:", error.message)
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
