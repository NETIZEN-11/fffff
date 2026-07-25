import OpenAI from "openai";

const rawKey = process.env.OPENAI_API_KEY;

// Fail fast in production. A missing key would otherwise surface as
// confusing 401s at request time and potentially cost the user quota
// on doomed AI calls.
if (process.env.NODE_ENV === "production" && !rawKey) {
  throw new Error(
    "OPENAI_API_KEY is required in production. Set it in your environment."
  );
}

// In dev/test, use a placeholder so local dev doesn't crash on import.
// Real calls will fail at request time with a clear 401 from OpenAI.
export const openai = new OpenAI({
  apiKey: rawKey ?? "sk-placeholder-not-for-production",
  dangerouslyAllowBrowser: true,
});

export const AI_MODELS = {
  analysis: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  rewrite: process.env.OPENAI_REWRITE_MODEL ?? "gpt-4o",
  embedding: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;
