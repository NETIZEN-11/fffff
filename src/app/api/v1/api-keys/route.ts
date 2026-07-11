import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import crypto from "crypto";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  validationErrorResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { ZodError } from "zod";

const MAX_API_KEYS = 10;

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  expiresIn: z
    .enum(["7d", "30d", "90d", "1y", "never"])
    .optional()
    .default("never"),
});

function computeExpiry(expiresIn: string): Date | null {
  if (expiresIn === "never") return null;
  const now = Date.now();
  const map: Record<string, number> = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(now + map[expiresIn]);
}

// GET /api/v1/api-keys — list keys (without revealing full key)
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const keys = await db.apiKey.findMany({
      where: { userId: session.user.id, isActive: true },
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(keys, "API keys retrieved");
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/v1/api-keys — generate new key
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    // Enforce max keys limit
    const count = await db.apiKey.count({
      where: { userId: session.user.id, isActive: true },
    });
    if (count >= MAX_API_KEYS) {
      return errorResponse(
        `You can have at most ${MAX_API_KEYS} active API keys. Revoke some to create new ones.`,
        400
      );
    }

    const body = await req.json();
    const validated = createKeySchema.parse(body);

    // Generate: prefix (first 8 chars shown publicly) + secret (32 bytes)
    const secret = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    const prefix = `rr_${crypto.randomBytes(4).toString("hex")}`; // e.g. rr_a1b2c3d4
    const rawKey = `${prefix}_${secret}`;

    // Store SHA-256 hash — never store the raw key
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const expiresAt = computeExpiry(validated.expiresIn);

    const apiKey = await db.apiKey.create({
      data: {
        userId: session.user.id,
        name: validated.name,
        keyHash,
        prefix,
        expiresAt,
        isActive: true,
      },
    });

    // Return the raw key ONCE — it will never be shown again
    return successResponse(
      {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        key: rawKey, // shown only once
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      },
      "API key created. Copy it now — it will not be shown again.",
      undefined,
      201
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
