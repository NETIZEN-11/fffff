import { NextRequest } from "next/server";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  validationErrorResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { rateLimit } from "@/shared/utils/rate-limit";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

const deleteSchema = z.object({
  confirmation: z.literal("DELETE MY ACCOUNT"),
  password: z.string().min(1, "Password is required"),
});

// DELETE /api/v1/account
// Permanently deletes the authenticated user and all of their data
// (GDPR right-to-erasure). This is a hard delete — the user row, all
// resumes / JDs / analyses / notifications / API keys, plus soft-delete
// rows in cover letters and analyses.
//
// Requires a typed confirmation phrase + current password to prevent
// drive-by deletion (e.g. from an XSS that exfiltrated the session).
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  // Low limit: deletion is destructive, so we cap how often a user
  // can attempt it (5/hour). 429 gives them time to think, not a
  // way to brute-force the password.
  const limit = await rateLimit(req, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.success) {
    return errorResponse("Too many deletion attempts. Try again in an hour.", 429);
  }

  try {
    const body = await req.json();
    const { confirmation, password } = deleteSchema.parse(body);

    if (confirmation !== "DELETE MY ACCOUNT") {
      return errorResponse("Type DELETE MY ACCOUNT to confirm.", 400);
    }

    // Verify password before we touch the DB. We require the user's
    // CURRENT password to prevent drive-by deletion from a stolen
    // session cookie.
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true, email: true },
    });
    if (!user || !user.passwordHash) {
      // OAuth-only accounts (no password) cannot use this endpoint.
      // They should contact support for account deletion.
      return errorResponse(
        "This account was created with a social login. Contact support to delete it.",
        400
      );
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return errorResponse("Incorrect password", 401);
    }

    const userId = session.user.id;

    // Hard delete in dependency order. We use $transaction so a
    // mid-sequence failure doesn't leave the user in a half-deleted
    // state. Cover letters, analyses, and other soft-delete-aware
    // tables are *hard* deleted here — the user is gone, so the
    // soft-delete tombstone is meaningless.
    await db.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.coverLetter.updateMany({
        where: { userId },
        data: { deletedAt: new Date() },
      });
      await tx.coverLetter.deleteMany({ where: { userId } });
      await tx.resumeAnalysis.updateMany({
        where: { userId },
        data: { deletedAt: new Date() },
      });
      await tx.resumeAnalysis.deleteMany({ where: { userId } });
      await tx.resume.deleteMany({ where: { userId } });
      await tx.jobDescription.deleteMany({ where: { userId } });
      await tx.payment.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.profile.deleteMany({ where: { userId } });
      // Sessions + accounts cascade from User delete via the
      // onDelete: Cascade foreign keys, but be explicit for the
      // ones that aren't cascaded.
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.teamMember.deleteMany({ where: { userId } });
      await tx.auditLog.deleteMany({ where: { userId } });
      // Referral rows: keep the row as a tombstone (referrerId points
      // to a deleted user) by setting referredId to null instead of
      // cascading the delete.
      await tx.referral.updateMany({
        where: { referredId: userId },
        data: { referredId: null, status: "PENDING" },
      });
      // And finally the user.
      await tx.user.delete({ where: { id: userId } });
    });

    logger.info({ userId }, "User account deleted (GDPR erasure)");

    // Sign out — destroy the session so the cookie no longer points
    // at a deleted user.
    await signOut({ redirect: false });

    return successResponse(null, "Your account has been permanently deleted.");
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
