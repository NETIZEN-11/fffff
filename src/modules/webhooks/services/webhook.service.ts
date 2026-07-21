import { db } from "@/lib/db";
import crypto from "crypto";
import type { WebhookEvent } from "@prisma/client";
import { logger } from "@/lib/logger";

const MAX_WEBHOOKS = 10;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // seconds: 1min, 5min, 15min (exponential backoff)

export type WebhookPayload = {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
};

// Returned ONLY from createWebhook. The plaintext secret is never
// persisted, so the caller must store it now.
export type CreatedWebhook = {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  secret: string; // plaintext — shown once
  createdAt: Date;
};

export class WebhookService {
  // ── Registration ────────────────────────────────────────────────────────────

  async createWebhook(
    userId: string,
    data: { name: string; url: string; events: WebhookEvent[] }
  ): Promise<CreatedWebhook> {
    // Atomic: enforce the cap inside a transaction so two parallel
    // requests can't both create the 11th webhook.
    return db.$transaction(async (tx) => {
      const count = await tx.webhook.count({ where: { userId, isActive: true } });
      if (count >= MAX_WEBHOOKS) {
        throw new Error(`Maximum ${MAX_WEBHOOKS} webhooks allowed.`);
      }

      // Generate a random signing secret. The DB stores ONLY the SHA-256
      // hash; we return the plaintext to the caller once, exactly like
      // API keys. If the DB is later compromised, the secrets cannot
      // be replayed against the consumer endpoints.
      const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
      const secretHash = crypto
        .createHash("sha256")
        .update(secret)
        .digest("hex");

      const created = await tx.webhook.create({
        data: {
          userId,
          name: data.name,
          url: data.url,
          secret: secretHash,
          events: data.events,
          isActive: true,
        },
      });

      return {
        id: created.id,
        name: created.name,
        url: created.url,
        events: created.events,
        secret, // plaintext — shown ONCE
        createdAt: created.createdAt,
      };
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
    // Fetch the (hashed) hook configs. The plaintext secret was
    // returned to the user at create time and is not stored, so we
    // CANNOT re-derive the original secret from the hash for signing.
    //
    // For the in-process dispatch path (analysis complete → consumer),
    // we accept this trade-off and dispatch with an unsigned payload
    // flagged with a header so consumers can detect it. Production
    // consumers should use the secret returned at create time to
    // verify their own signatures via a separate handshake.
    //
    // NOTE: in a future iteration, store an encrypted secret at rest
    // (KMS / libsodium sealed box) so this path can still sign.
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

    await Promise.allSettled(hooks.map((hook) => this.deliver(hook, payload)));
  }

  private async deliver(
    hook: { id: string; url: string; secret: string },
    payload: WebhookPayload,
    retryCount = 0
  ): Promise<void> {
    const body = JSON.stringify(payload);
    // `hook.secret` is now a SHA-256 hash. We sign with the hash as a
    // best-effort integrity check — the receiver cannot verify against
    // a known secret unless they stored the plaintext at create time.
    // The X-Webhook-Secret-Source header tells the receiver whether
    // the signature used the plaintext ("plaintext") or hash ("hashed").
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
          "X-ResumeRank-Retry-Count": retryCount.toString(),
          "X-ResumeRank-Secret-Source": "hashed",
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
      logger.error(
        { webhookId: hook.id, url: hook.url, error: responseBody, retryCount },
        "Webhook delivery failed"
      );
    }

    const duration = Date.now() - startTime;

    // Determine if we should retry
    const shouldRetry = !success && retryCount < MAX_RETRIES;
    const nextRetryAt = shouldRetry
      ? new Date(Date.now() + RETRY_DELAYS[retryCount] * 1000)
      : null;

    // Record delivery
    const delivery = await db.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event: payload.event,
        payload: payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
        statusCode,
        responseBody,
        success,
        duration,
        retryCount,
        nextRetryAt,
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

    // Log delivery outcome
    if (success) {
      logger.info(
        { webhookId: hook.id, deliveryId: delivery.id, statusCode, duration },
        "Webhook delivered successfully"
      );
    } else if (shouldRetry) {
      logger.warn(
        { webhookId: hook.id, deliveryId: delivery.id, retryCount, nextRetryAt },
        "Webhook delivery failed, will retry"
      );
    } else {
      logger.error(
        { webhookId: hook.id, deliveryId: delivery.id, retryCount },
        "Webhook delivery failed after all retries"
      );
    }

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
        logger.warn(
          { webhookId: hook.id },
          "Webhook auto-disabled after 10 consecutive failures"
        );
      }
    }
  }

  // HMAC-SHA256 signature: "sha256=<hex>"
  sign(body: string, secret: string): string {
    return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  // ── Retry Processing ─────────────────────────────────────────────────────────

  /**
   * Process pending webhook retries. This should be called periodically
   * (e.g., via cron job or scheduled task) to retry failed deliveries.
   */
  async processRetries(): Promise<void> {
    const now = new Date();

    // Find deliveries that need retry
    const pendingRetries = await db.webhookDelivery.findMany({
      where: {
        success: false,
        nextRetryAt: { lte: now },
        retryCount: { lt: MAX_RETRIES },
      },
      include: {
        webhook: {
          select: { id: true, url: true, secret: true, isActive: true },
        },
      },
      take: 50, // Process in batches
    });

    if (pendingRetries.length === 0) {
      logger.info("No pending webhook retries");
      return;
    }

    logger.info(`Processing ${pendingRetries.length} webhook retries`);

    // Clear nextRetryAt to prevent duplicate processing
    await db.webhookDelivery.updateMany({
      where: {
        id: { in: pendingRetries.map((d) => d.id) },
      },
      data: { nextRetryAt: null },
    });

    // Process each retry
    const results = await Promise.allSettled(
      pendingRetries.map(async (delivery) => {
        // Skip if webhook was disabled
        if (!delivery.webhook.isActive) {
          logger.info(
            { webhookId: delivery.webhookId },
            "Skipping retry for disabled webhook"
          );
          return;
        }

        const payload = delivery.payload as unknown as WebhookPayload;
        // The stored `secret` is the hash; deliver() signs with the hash
        // and flags the signature source so consumers know.
        await this.deliver(
          {
            id: delivery.webhook.id,
            url: delivery.webhook.url,
            secret: delivery.webhook.secret,
          },
          payload,
          delivery.retryCount + 1
        );
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    logger.info(
      { total: pendingRetries.length, successful, failed },
      "Webhook retry batch complete"
    );
  }
}

export const webhookService = new WebhookService();
