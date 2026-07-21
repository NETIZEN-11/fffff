import { NextRequest } from "next/server";
import { webhookService } from "@/modules/webhooks/services/webhook.service";
import { successResponse, handleApiError, errorResponse } from "@/shared/utils/api-response";
import { logger } from "@/lib/logger";

/**
 * POST /api/v1/webhooks/retry
 * 
 * Process pending webhook retries. This endpoint should be called periodically
 * by a cron job or scheduled task to retry failed webhook deliveries.
 * 
 * Authentication: Requires WEBHOOK_RETRY_SECRET in Authorization header
 */
export async function POST(req: NextRequest) {
  try {
    // Verify secret token (for cron job authentication)
    const authHeader = req.headers.get("authorization");
    const expectedSecret = process.env.WEBHOOK_RETRY_SECRET;

    if (!expectedSecret) {
      logger.error("WEBHOOK_RETRY_SECRET not configured");
      return errorResponse("Retry endpoint not configured", 500);
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      logger.warn(
        { ip: req.headers.get("x-forwarded-for") || "unknown" },
        "Unauthorized webhook retry attempt"
      );
      return errorResponse("Unauthorized", 401);
    }

    logger.info("Starting webhook retry processing");
    await webhookService.processRetries();

    return successResponse(null, "Webhook retries processed");
  } catch (error) {
    logger.error({ error }, "Error processing webhook retries");
    return handleApiError(error);
  }
}
