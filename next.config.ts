import type { NextConfig } from "next"

const isProd = process.env.NODE_ENV === "production"
// Vercel's preview toolbar/comments need extra origins; never allow them in prod.
const isVercelPreview = process.env.VERCEL_ENV === "preview"

const resolveSupabaseOrigin = (): string => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return "https://*.supabase.co"
  try {
    return new URL(raw).origin
  } catch {
    return "https://*.supabase.co"
  }
}

const supabaseOrigin = resolveSupabaseOrigin()
const supabaseRealtimeOrigin = supabaseOrigin.replace(/^http/, "ws")

/**
 * Static CSP. `'unsafe-inline'` is required for scripts because Next.js emits
 * inline bootstrap/hydration scripts and a static header cannot carry a
 * per-request nonce. A nonce-based strict CSP needs per-request middleware
 * (proxy.ts) and fully dynamic rendering — see
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
 * `'unsafe-eval'` is dev-only (React debugging).
 */
const buildContentSecurityPolicy = (): string => {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "https://js.stripe.com",
      ...(isProd ? [] : ["'unsafe-eval'"]),
      ...(isVercelPreview ? ["https://vercel.live"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "blob:",
      "data:",
      supabaseOrigin,
      ...(isVercelPreview ? ["https://vercel.live", "https://vercel.com"] : []),
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      supabaseOrigin,
      supabaseRealtimeOrigin,
      "https://api.stripe.com",
      ...(isProd ? [] : ["ws://localhost:*", "ws://127.0.0.1:*"]),
      ...(isVercelPreview
        ? ["https://vercel.live", "wss://ws-us3.pusher.com"]
        : []),
    ],
    "frame-src": [
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://checkout.stripe.com",
      ...(isVercelPreview ? ["https://vercel.live"] : []),
    ],
    // Server Actions redirect to Stripe Checkout / Billing Portal after a
    // form POST; browsers enforce form-action on that redirect target.
    "form-action": [
      "'self'",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  }

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ")

  // Only where HTTPS is guaranteed; it would break a local `next start`.
  return process.env.VERCEL ? `${policy}; upgrade-insecure-requests` : policy
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Legacy equivalent of CSP frame-ancestors for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
