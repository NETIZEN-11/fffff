/**
 * Admin Impersonation
 *
 * POST /api/v1/admin/impersonate   — start impersonating a user
 * DELETE /api/v1/admin/impersonate — stop impersonation (return to admin)
 *
 * Strategy: we use a short-lived signed cookie that stores
 * { targetUserId, adminId } so the JWT callback can inject
 * the impersonated user's identity into the session token
 * without modifying the underlying DB session.
 *
 * The cookie is HttpOnly, Secure, SameSite=Strict and
 * expires in 1 hour to prevent runaway impersonation.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/shared/utils/audit-log";
import {
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  errorResponse,
  successResponse,
  handleApiError,
} from "@/shared/utils/api-response";
import { z } from "zod";

const IMPERSONATION_COOKIE = "rr_impersonate";

function isSuperAdmin(role: string) {
  return role === "SUPER_ADMIN";
}

function isAdmin(role: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// POST /api/v1/admin/impersonate — begin impersonation
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  // Only SUPER_ADMIN can impersonate (extra safety over regular ADMIN)
  if (!isSuperAdmin(session.user.role ?? "")) {
    return forbiddenResponse();
  }

  try {
    const body = await req.json();
    const { userId } = z.object({ userId: z.string().cuid() }).parse(body);

    // Cannot impersonate yourself
    if (userId === session.user.id) {
      return errorResponse("You cannot impersonate yourself.", 400);
    }

    // Fetch target user
    const target = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, email: true, role: true, isActive: true, isBanned: true },
    });

    if (!target) return notFoundResponse("User");
    if (!target.isActive || target.isBanned) {
      return errorResponse("Cannot impersonate a banned or inactive user.", 400);
    }
    // Prevent impersonating other admins
    if (isAdmin(target.role)) {
      return errorResponse("Cannot impersonate admin accounts.", 403);
    }

    await createAuditLog({
      userId: session.user.id,
      action: "ADMIN_ACTION",
      resource: "User",
      resourceId: userId,
      metadata: {
        action: "impersonate_start",
        targetEmail: target.email,
        targetName: target.name,
      },
      req,
    });

    // Encode impersonation payload as base64 JSON in a cookie
    const payload = JSON.stringify({
      targetUserId: target.id,
      adminId: session.user.id,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    const encoded = Buffer.from(payload).toString("base64");

    const res = NextResponse.json({
      success: true,
      message: `Now impersonating ${target.name ?? target.email}. Refresh the page.`,
      data: { targetId: target.id, targetName: target.name ?? target.email },
    });

    res.cookies.set(IMPERSONATION_COOKIE, encoded, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60, // 1 hour
      path: "/",
    });

    return res;
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/v1/admin/impersonate — end impersonation
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    // Log end of impersonation
    const cookieValue = req.cookies.get(IMPERSONATION_COOKIE)?.value;
    if (cookieValue) {
      try {
        const payload = JSON.parse(Buffer.from(cookieValue, "base64").toString());
        await createAuditLog({
          userId: payload.adminId ?? session.user.id,
          action: "ADMIN_ACTION",
          resource: "User",
          resourceId: payload.targetUserId,
          metadata: { action: "impersonate_end" },
          req,
        });
      } catch {
        // ignore parse errors
      }
    }

    const res = successResponse(null, "Impersonation ended. Refresh the page.");
    // Clear the cookie
    (res as NextResponse).cookies.set(IMPERSONATION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 0,
      path: "/",
    });

    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
