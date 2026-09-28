import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          // Mirror refreshed cookies onto the request so downstream Server
          // Components in *this* render see the new session immediately.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          // Rebuild the response from the mutated request, then mirror the
          // same cookies onto it so the browser receives the Set-Cookie
          // headers for the *next* request.
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )

          // Auth cookie writes must never be cached by a CDN/reverse proxy
          // (it would leak one user's session to another). Forward the
          // cache-control headers @supabase/ssr provides for this response.
          Object.entries(headers).forEach(([key, headerValue]) => {
            response.headers.set(key, headerValue)
          })
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between `createServerClient` and
  // `supabase.auth.getUser()`. A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  //
  // This call is what actually refreshes the session — it validates the
  // access token and, if expired, uses the refresh token to get a new one,
  // which triggers the `setAll` callback above.
  await supabase.auth.getUser()

  // This middleware only refreshes the session. Add route-protection
  // (redirects for unauthenticated users) here once you have auth pages.

  // IMPORTANT: You *must* return the `response` object as it is. If you
  // create a new response object here (e.g. `NextResponse.next()`), make
  // sure to copy over the cookies set above, or the refreshed session will
  // not be persisted to the browser, causing random logouts.
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
