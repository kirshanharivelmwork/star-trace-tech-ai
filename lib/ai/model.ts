/**
 * Single source of truth for the LLM used by every route handler.
 * `claude-sonnet-4-6` is part of the model-id union exported by the
 * installed `@ai-sdk/anthropic` package, so it type-checks as a known id.
 */
export const LLM_MODEL_ID = "claude-sonnet-4-6" as const
