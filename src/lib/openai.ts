import OpenAI from "openai";

// In development, a placeholder key is acceptable — AI calls will fail
// gracefully at call time rather than crashing the server on import.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "sk-placeholder",
});

export const AI_MODELS = {
  analysis: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  rewrite: process.env.OPENAI_REWRITE_MODEL ?? "gpt-4o",
  embedding: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;
