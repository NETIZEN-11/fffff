import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  errorResponse,
} from "@/shared/utils/api-response";

type Params = { params: Promise<{ id: string; memberId: string }> };

// DELETE /api/v1/teams/:id/members/:memberId — remove member or leave team
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id, memberId } = await params;

    const team = await db.team.findUnique({ where: { id } });
    if (!team) return notFoundResponse("Team");

    const member = await db.teamMember.findUnique({ where: { id: memberId } });
    if (!member || member.teamId !== id) return notFoundResponse("Member");

    // Allow: team owner removing anyone, or member removing themselves
    const isOwner = team.ownerId === session.user.id;
    const isSelf = member.userId === session.user.id;

    if (!isOwner && !isSelf) return forbiddenResponse();

    // Owner cannot remove themselves
    if (isSelf && isOwner) {
      return errorResponse(
        "You cannot remove yourself as the owner. Delete the team instead.",
        400
      );
    }

    await db.teamMember.delete({ where: { id: memberId } });

    return successResponse(null, isSelf ? "You have left the team" : "Member removed");
  } catch (error) {
    return handleApiError(error);
  }
}
