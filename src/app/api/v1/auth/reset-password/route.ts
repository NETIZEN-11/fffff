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

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});

export async function POST(req: NextRequest) {
  // Rate limit: 5 attempts per minute per IP
  const limit = await rateLimit(req, { limit: 5, windowMs: 60_000 });
  if (!limit.success) {
    return errorResponse("Too many attempts. Please try again later.", 429);
  }

  try {
    const body = await req.json();
    const validated = resetPasswordSchema.parse(body);

    await authService.resetPassword(
      validated.email,
      validated.token,
      validated.password
    );

    return successResponse(null, "Password reset successfully. You can now sign in.");
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
