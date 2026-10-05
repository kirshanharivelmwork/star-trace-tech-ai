import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_EXACT = new Set(["/", "/login"])

const isPublicPath = (pathname: string): boolean => {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (pathname.startsWith("/auth/callback")) return true
  if (pathname.startsWith("/api/stripe/webhook")) return true
  if (pathname.startsWith("/api/cron/alerts")) return true
  return false
}

const copyCookiesAndCacheHeaders = (
  from: NextResponse,
  to: NextResponse
): NextResponse => {
  // Pass the whole cookie (path, maxAge, httpOnly, sameSite, secure…), not
  // just name/value, or refreshed auth cookies lose their attributes.
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie)
  })
  from.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === "cache-control" || lower === "pragma") {
      to.headers.set(key, value)
    }
  })
  return to
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )

          Object.entries(headers).forEach(([key, headerValue]) => {
            response.headers.set(key, headerValue)
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const publicPath = isPublicPath(pathname)

  if (!user && !publicPath) {
    if (pathname.startsWith("/api/")) {
      const unauthorized = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
      return copyCookiesAndCacheHeaders(response, unauthorized)
    }

    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/login"
    loginUrl.search = ""
    if (pathname !== "/login") {
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    }
    return copyCookiesAndCacheHeaders(response, NextResponse.redirect(loginUrl))
  }

  if (user && pathname === "/login") {
    const appUrl = request.nextUrl.clone()
    appUrl.pathname = "/app"
    appUrl.search = ""
    return copyCookiesAndCacheHeaders(response, NextResponse.redirect(appUrl))
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
