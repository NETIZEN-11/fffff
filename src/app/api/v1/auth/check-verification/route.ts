import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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

// POST /api/v1/auth/check-verification
// Returns whether the account for the given email is unverified.
// Used by the sign-in form to distinguish "EmailNotVerified" from
// "wrong password" (NextAuth collapses both into "CredentialsSignin").
export async function POST(req: NextRequest) {
  // Without this limit an attacker can probe which emails are
  // registered and which are unverified, by hammering the endpoint.
  const limit = await rateLimit(req, { limit: 20, windowMs: 60_000 });
  if (!limit.success) {
    return errorResponse("Too many requests. Please try again later.", 429);
  }

  try {
    const body = await req.json();
    const { email } = schema.parse(body);

    const user = await db.user.findUnique({
      where: { email, deletedAt: null },
      select: { emailVerified: true, passwordHash: true },
    });

    // Only report "unverified" when the account exists with a password
    // (credentials user) AND email is not yet verified.
    if (user && user.passwordHash && !user.emailVerified) {
      return successResponse({ status: "unverified" });
    }

    // For all other cases (no account, OAuth-only, or already verified)
    // return "ok" — don't reveal account existence.
    return successResponse({ status: "ok" });
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
