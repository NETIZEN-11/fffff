import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  processAnalysisJob,
  sendAnalysisCompleteEmailJob,
  sendWelcomeEmailJob,
} from "@/modules/analysis/jobs/analysis.job";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processAnalysisJob,
    sendAnalysisCompleteEmailJob,
    sendWelcomeEmailJob,
  ],
});
