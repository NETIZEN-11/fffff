import { db } from "@/lib/db";
import crypto from "crypto";
import type { WebhookEvent } from "@prisma/client";

const MAX_WEBHOOKS = 10;

export type WebhookPayload = {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
};

export class WebhookService {
  // ── Registration ────────────────────────────────────────────────────────────

  async createWebhook(
    userId: string,
    data: { name: string; url: string; events: WebhookEvent[] }
  ) {
    const count = await db.webhook.count({ where: { userId, isActive: true } });
    if (count >= MAX_WEBHOOKS) {
      throw new Error(`Maximum ${MAX_WEBHOOKS} webhooks allowed.`);
    }

    // Generate a random signing secret (shown once to user, stored as plain text
    // so we can include it in the signature header)
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

    return db.webhook.create({
      data: {
        userId,
        name: data.name,
        url: data.url,
        secret,
        events: data.events,
        isActive: true,
      },
    });
  }

  async listWebhooks(userId: string) {
    return db.webhook.findMany({
      where: { userId, isActive: true },
      include: {
        _count: { select: { deliveries: true } },
        deliveries: {
          orderBy: { attemptedAt: "desc" },
          take: 1,
          select: { success: true, statusCode: true, attemptedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteWebhook(id: string, userId: string) {
    const hook = await db.webhook.findFirst({ where: { id, userId } });
    if (!hook) throw new Error("Webhook not found");
    // Soft-disable rather than deleting to preserve delivery history
    await db.webhook.update({ where: { id }, data: { isActive: false } });
  }

  async getDeliveries(webhookId: string, userId: string) {
    const hook = await db.webhook.findFirst({ where: { id: webhookId, userId } });
    if (!hook) throw new Error("Webhook not found");

    return db.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { attemptedAt: "desc" },
      take: 50,
    });
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────

  async dispatchEvent(
    userId: string,
    event: WebhookEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    const hooks = await db.webhook.findMany({
      where: {
        userId,
        isActive: true,
        events: { has: event },
      },
    });

    if (hooks.length === 0) return;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Fire all webhooks in parallel (non-blocking — don't throw if delivery fails)
    await Promise.allSettled(hooks.map((hook) => this.deliver(hook, payload)));
  }

  private async deliver(
    hook: { id: string; url: string; secret: string },
    payload: WebhookPayload
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, hook.secret);
    const startTime = Date.now();

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ResumeRank-Signature": signature,
          "X-ResumeRank-Event": payload.event,
          "X-ResumeRank-Timestamp": payload.timestamp,
          "User-Agent": "ResumeRankWebhook/1.0",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      statusCode = res.status;
      responseBody = (await res.text()).substring(0, 500);
      success = res.ok;
    } catch (err) {
      responseBody = err instanceof Error ? err.message : "Delivery failed";
    }

    const duration = Date.now() - startTime;

    // Record delivery
    await db.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event: payload.event,
        payload: payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
        statusCode,
        responseBody,
        success,
        duration,
      },
    });

    // Update webhook stats
    await db.webhook.update({
      where: { id: hook.id },
      data: {
        lastFiredAt: new Date(),
        failCount: success ? 0 : { increment: 1 },
      },
    });

    // Auto-disable after 10 consecutive failures
    if (!success) {
      const hook2 = await db.webhook.findUnique({
        where: { id: hook.id },
        select: { failCount: true },
      });
      if ((hook2?.failCount ?? 0) >= 10) {
        await db.webhook.update({
          where: { id: hook.id },
          data: { isActive: false },
        });
      }
    }
  }

  // HMAC-SHA256 signature: "sha256=<hex>"
  sign(body: string, secret: string): string {
    return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }
}

export const webhookService = new WebhookService();
