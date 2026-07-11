import { db } from "@/lib/db";
import type { AuditAction } from "@prisma/client";
import type { NextRequest } from "next/server";

export async function createAuditLog(data: {
  userId?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  req?: NextRequest;
}): Promise<void> {
  try {
    const ipAddress = data.req?.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
    const userAgent = data.req?.headers.get("user-agent") ?? null;

    await db.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch {
    console.error("Failed to create audit log");
  }
}
