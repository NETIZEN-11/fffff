import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { rateLimit } from "@/shared/utils/rate-limit";
import type { NextRequest } from "next/server";

// GET /api/v1/account/export
// Returns a JSON document containing everything we hold about the
// authenticated user. This is the GDPR "right to data portability"
// requirement — the user can download their data in a machine-readable
// format. The export is generated on demand; we don't keep a cache.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  // Low limit: this hits multiple tables and we'd rather not have a
  // user trigger it on a tight loop.
  const limit = await rateLimit(req, { limit: 3, windowMs: 60 * 60_000 });
  if (!limit.success) {
    return errorResponse("Too many export requests. Try again in an hour.", 429);
  }

  try {
    const userId = session.user.id;

    const [
      user,
      profile,
      subscription,
      resumes,
      jobDescriptions,
      analyses,
      coverLetters,
      notifications,
      payments,
      apiKeys,
      webhooks,
      teamMemberships,
    ] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      db.profile.findUnique({ where: { userId } }),
      db.subscription.findUnique({
        where: { userId },
        select: {
          plan: true,
          status: true,
          analysesUsed: true,
          analysesLimit: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          createdAt: true,
        },
      }),
      db.resume.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          fileName: true,
          fileType: true,
          version: true,
          tags: true,
          createdAt: true,
        },
      }),
      db.jobDescription.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          title: true,
          company: true,
          description: true,
          url: true,
          tags: true,
          createdAt: true,
        },
      }),
      db.resumeAnalysis.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          jobTitle: true,
          company: true,
          atsScore: true,
          resumeScore: true,
          skillMatchPct: true,
          status: true,
          createdAt: true,
          completedAt: true,
          atsBreakdown: true,
          matchedSkills: true,
          missingSkills: true,
          recommendations: true,
        },
      }),
      db.coverLetter.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          tone: true,
          body: true,
          wordCount: true,
          createdAt: true,
        },
      }),
      db.notification.findMany({
        where: { userId },
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          isRead: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.payment.findMany({
        where: { userId },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.apiKey.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          prefix: true,
          permissions: true,
          lastUsedAt: true,
          createdAt: true,
          // keyHash is sensitive and never exported
        },
      }),
      db.webhook.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          url: true,
          events: true,
          isActive: true,
          createdAt: true,
          // secret is hashed; we don't export the hash
        },
      }),
      db.teamMember.findMany({
        where: { userId },
        select: {
          id: true,
          team: { select: { id: true, name: true, slug: true } },
          role: true,
          joinedAt: true,
        },
      }),
    ]);

    const exportPayload = {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      user,
      profile,
      subscription,
      resumes,
      jobDescriptions,
      analyses,
      coverLetters,
      notifications,
      payments,
      apiKeys,
      webhooks,
      teamMemberships,
    };

    return successResponse(exportPayload, "Account data export generated");
  } catch (error) {
    return handleApiError(error);
  }
}
