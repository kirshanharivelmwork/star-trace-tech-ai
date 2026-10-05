import { afterEach, describe, expect, it, vi } from "vitest"

import {
  assertProductionEnv,
  getEnvProblems,
  REQUIRED_PRODUCTION_ENV,
} from "@/lib/env"

const completeEnv = (): Record<string, string> => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  STRIPE_SECRET_KEY: "sk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_x",
  RESEND_API_KEY: "re_x",
  RESEND_FROM_EMAIL: "alerts@example.com",
  ANTHROPIC_API_KEY: "sk-ant-x",
  CRON_SECRET: "cron",
})

afterEach(() => vi.restoreAllMocks())

describe("getEnvProblems", () => {
  it("accepts a complete environment", () => {
    expect(getEnvProblems(completeEnv())).toEqual([])
  })

  it("reports every missing variable by name", () => {
    expect(getEnvProblems({})).toHaveLength(REQUIRED_PRODUCTION_ENV.length)
  })

  it("treats blank/whitespace values as missing", () => {
    const problems = getEnvProblems({ ...completeEnv(), CRON_SECRET: "   " })
    expect(problems).toEqual([expect.stringContaining("CRON_SECRET")])
  })

  it("accepts RESEND_FROM instead of RESEND_FROM_EMAIL", () => {
    const env = completeEnv()
    delete env.RESEND_FROM_EMAIL
    expect(getEnvProblems(env)).toHaveLength(1)
    expect(
      getEnvProblems({ ...env, RESEND_FROM: "StarFlow <a@example.com>" })
    ).toEqual([])
  })

  it("rejects URL variables that are not valid URLs", () => {
    const problems = getEnvProblems({
      ...completeEnv(),
      NEXT_PUBLIC_APP_URL: "not a url",
    })
    expect(problems).toEqual([expect.stringContaining("NEXT_PUBLIC_APP_URL")])
  })

  it("never includes variable VALUES in the messages", () => {
    const problems = getEnvProblems({
      ...completeEnv(),
      NEXT_PUBLIC_APP_URL: "super-secret-not-a-url",
    })
    expect(problems.join()).not.toContain("super-secret-not-a-url")
  })
})

describe("assertProductionEnv", () => {
  it("does nothing outside production (dev/test don't need every secret)", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "development" })).not.toThrow()
    expect(() => assertProductionEnv({ NODE_ENV: "test" })).not.toThrow()
  })

  it("throws in production when variables are missing", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).toThrow(
      /Invalid production environment/
    )
  })

  it("does not throw in production with a complete environment", () => {
    expect(() =>
      assertProductionEnv({ ...completeEnv(), NODE_ENV: "production" })
    ).not.toThrow()
  })

  it("only logs on Vercel preview deployments", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      assertProductionEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" })
    ).not.toThrow()
    expect(error).toHaveBeenCalled()
  })

  it("still throws on Vercel production", () => {
    expect(() =>
      assertProductionEnv({ NODE_ENV: "production", VERCEL_ENV: "production" })
    ).toThrow()
  })
})
