import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from "@/shared/utils/api-response";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/v1/api-keys/:id — revoke (soft delete) a key
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id } = await params;

    const key = await db.apiKey.findUnique({ where: { id } });
    if (!key) return notFoundResponse("API key");
    if (key.userId !== session.user.id) return forbiddenResponse();

    // Soft-revoke: mark inactive rather than deleting (preserves audit history)
    await db.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    return successResponse(null, "API key revoked");
  } catch (error) {
    return handleApiError(error);
  }
}
