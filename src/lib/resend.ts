import { Resend } from "resend";

// In development, a placeholder key is acceptable — email sending will fail
// gracefully at call time rather than crashing the server on import.
const apiKey = process.env.RESEND_API_KEY ?? "re_placeholder";

export const resend = new Resend(apiKey);

export const EMAIL_CONFIG = {
  from: `${process.env.RESEND_FROM_NAME ?? "ResumeRank AI"} <${process.env.RESEND_FROM_EMAIL ?? "noreply@resumerank.ai"}>`,
  replyTo: process.env.RESEND_FROM_EMAIL ?? "noreply@resumerank.ai",
} as const;
