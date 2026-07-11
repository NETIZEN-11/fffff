import { NextRequest } from "next/server";
import { z } from "zod";
import { authService } from "@/modules/auth/services/auth.service";
import {
  successResponse,
  handleApiError,
  validationErrorResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { rateLimit } from "@/shared/utils/rate-limit";
import { ZodError } from "zod";

const schema = z.object({
  email: z.string().email(),
});

// POST /api/v1/auth/resend-verification
export async function POST(req: NextRequest) {
  const limit = await rateLimit(req, { limit: 3, windowMs: 60_000 });
  if (!limit.success) {
    return errorResponse("Too many requests. Please wait before trying again.", 429);
  }

  try {
    const body = await req.json();
    const { email } = schema.parse(body);

    await authService.resendVerificationEmail(email);

    // Always return success (prevents email enumeration)
    return successResponse(
      null,
      "If an unverified account exists with that email, a verification link has been sent."
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
