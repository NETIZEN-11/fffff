/**
 * Admin Impersonation
 *
 * POST /api/v1/admin/impersonate   — start impersonating a user
 * DELETE /api/v1/admin/impersonate — stop impersonation (return to admin)
 *
 * Strategy: short-lived signed JWT stored in an HttpOnly cookie. The JWT
 * carries { targetUserId, adminId, exp } and is verified by the auth
 * callback in src/auth.ts (which uses IMPERSONATION_SECRET).
 *
 * The cookie is HttpOnly, Secure (in production), SameSite=Strict, and
 * expires in 1 hour to prevent runaway impersonation.
 *
 * NOTE: previously this route stored base64 JSON, but the auth callback
 * in src/auth.ts calls jwtVerify() with IMPERSONATION_SECRET. Mismatch
 * meant impersonation never worked — the cookie was rejected and the
 * callback fell through to the normal session. Now both sides use the
 * same signed JWT, with jose.
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
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
const IMPERSONATION_TTL_SECONDS = 60 * 60; // 1 hour

function getImpersonationSecret(): Uint8Array {
  const secret = process.env.IMPERSONATION_SECRET;
  if (!secret) {
    throw new Error(
      "IMPERSONATION_SECRET environment variable is required."
    );
  }
  return new TextEncoder().encode(secret);
}

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

    // Sign a JWT with { targetUserId, adminId } — verified by jwtVerify()
    // in src/auth.ts using IMPERSONATION_SECRET.
    const jwt = await new SignJWT({
      targetUserId: target.id,
      adminId: session.user.id,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${IMPERSONATION_TTL_SECONDS}s`)
      .sign(getImpersonationSecret());

    const res = NextResponse.json({
      success: true,
      message: `Now impersonating ${target.name ?? target.email}. Refresh the page.`,
      data: { targetId: target.id, targetName: target.name ?? target.email },
    });

    res.cookies.set(IMPERSONATION_COOKIE, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: IMPERSONATION_TTL_SECONDS,
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
    // Log end of impersonation. We can't read the adminId from the JWT
    // here without verifying it, so we fall back to the current session.
    // (The auth callback has already swapped the session id to the
    // target user, so this audit is approximate — but good enough for
    // forensic purposes since the start was logged in the POST.)
    await createAuditLog({
      userId: session.user.id,
      action: "ADMIN_ACTION",
      resource: "User",
      metadata: { action: "impersonate_end" },
      req,
    });

    const res = successResponse(null, "Impersonation ended. Refresh the page.");
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
