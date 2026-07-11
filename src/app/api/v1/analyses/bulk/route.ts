import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  validationErrorResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { rateLimit } from "@/shared/utils/rate-limit";
import { createAuditLog } from "@/shared/utils/audit-log";
import { ZodError } from "zod";

const MAX_BULK = 10;

const schema = z.object({
  resumeId: z.string().cuid(),
  jobDescriptionIds: z
    .array(z.string().cuid())
    .min(2, "Select at least 2 job descriptions")
    .max(MAX_BULK, `Maximum ${MAX_BULK} analyses per bulk request`),
});

// POST /api/v1/analyses/bulk
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  const limit = await rateLimit(req, { limit: 3, windowMs: 60_000 });
  if (!limit.success) {
    return errorResponse("Too many bulk requests. Please wait a moment.", 429);
  }

  try {
    const body = await req.json();
    const validated = schema.parse(body);

    // Check subscription limits
    const subscription = await db.subscription.findUnique({
      where: { userId: session.user.id },
    });
    if (!subscription) return errorResponse("Subscription not found", 404);

    const remaining =
      subscription.plan === "FREE"
        ? subscription.analysesLimit - subscription.analysesUsed
        : Infinity;

    if (remaining < validated.jobDescriptionIds.length) {
      return errorResponse(
        `You only have ${remaining} analyses remaining this month. Reduce your selection or upgrade to Pro.`,
        402
      );
    }

    // Verify resume ownership
    const resume = await db.resume.findFirst({
      where: { id: validated.resumeId, userId: session.user.id, deletedAt: null },
    });
    if (!resume) return errorResponse("Resume not found", 404);

    // Verify all JDs belong to user
    const jds = await db.jobDescription.findMany({
      where: {
        id: { in: validated.jobDescriptionIds },
        userId: session.user.id,
        deletedAt: null,
      },
      select: { id: true, title: true },
    });

    if (jds.length !== validated.jobDescriptionIds.length) {
      return errorResponse("One or more job descriptions not found or inaccessible", 404);
    }

    // Create all analysis records + fire Inngest events
    const analyses = await Promise.all(
      jds.map(async (jd) => {
        const analysis = await db.resumeAnalysis.create({
          data: {
            userId: session.user.id,
            resumeId: validated.resumeId,
            jobDescriptionId: jd.id,
            status: "PENDING",
            jobTitle: jd.title,
          },
        });
        return analysis;
      })
    );

    // Increment subscription usage count
    await db.subscription.update({
      where: { userId: session.user.id },
      data: { analysesUsed: { increment: analyses.length } },
    });

    // Dispatch all Inngest jobs
    await inngest.send(
      analyses.map((a) => ({
        name: "analysis/requested" as const,
        data: {
          analysisId: a.id,
          userId: session.user.id,
          resumeId: validated.resumeId,
          jobDescriptionId: a.jobDescriptionId,
        },
      }))
    );

    // Single "bulk started" notification
    await db.notification.create({
      data: {
        userId: session.user.id,
        type: "SYSTEM",
        title: "Bulk Analysis Started",
        message: `${analyses.length} analyses queued for "${resume.title}". You'll be notified as each one completes.`,
        metadata: { count: analyses.length, resumeId: validated.resumeId },
      },
    });

    await createAuditLog({
      userId: session.user.id,
      action: "ANALYZE",
      resource: "ResumeAnalysis",
      metadata: { bulk: true, count: analyses.length, resumeId: validated.resumeId },
      req,
    });

    return successResponse(
      {
        queued: analyses.length,
        analysisIds: analyses.map((a) => a.id),
        resumeTitle: resume.title,
      },
      `${analyses.length} analyses queued successfully`,
      undefined,
      202
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
