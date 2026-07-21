import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  processAnalysisJob,
  sendAnalysisCompleteEmailJob,
  sendWelcomeEmailJob,
} from "@/modules/analysis/jobs/analysis.job";

// Signing key is required in production to verify that incoming Inngest
// webhooks are authentic. Without it, anyone who can reach /api/inngest
// could publish forged events (e.g. "analysis/requested" with a fake
// analysisId, triggering free AI work).
const signingKey = process.env.INNGEST_SIGNING_KEY;
if (process.env.NODE_ENV === "production" && !signingKey) {
  throw new Error(
    "INNGEST_SIGNING_KEY is required in production. Set it from your Inngest dashboard."
  );
}

export const { GET, POST, PUT } = serve({
  client: inngest,
  ...(signingKey ? { signingKey } : {}),
  functions: [
    processAnalysisJob,
    sendAnalysisCompleteEmailJob,
    sendWelcomeEmailJob,
  ],
});
