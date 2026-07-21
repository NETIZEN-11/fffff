import { auth } from "@/auth";
import { db } from "@/lib/db";
import { successResponse, errorResponse } from "@/shared/utils/api-response";

/**
 * GET /api/v1/teams/analyses
 * Returns all analyses from team members (shared analyses)
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // Check if user is part of a team
    const teamMember = await db.teamMember.findFirst({
      where: { userId: session.user.id },
      include: { team: true },
    });

    if (!teamMember) {
      return successResponse([]);
    }

    // Get all team member user IDs
    const teamMembers = await db.teamMember.findMany({
      where: { teamId: teamMember.teamId },
      select: { userId: true },
    });

    const userIds = teamMembers.map((m) => m.userId);

    // Get all analyses from team members
    const analyses = await db.resumeAnalysis.findMany({
      where: {
        userId: { in: userIds },
        deletedAt: null,
      },
      select: {
        id: true,
        jobTitle: true,
        company: true,
        atsScore: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50, // Limit to 50 most recent
    });

    return successResponse(analyses);
  } catch (error) {
    console.error("Team analyses error:", error);
    return errorResponse("Failed to fetch team analyses", 500);
  }
}
