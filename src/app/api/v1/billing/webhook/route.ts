import { NextRequest } from "next/server";
import { billingService } from "@/modules/billing/services/billing.service";
import { errorResponse } from "@/shared/utils/api-response";

// Stripe webhooks MUST run on the Node.js runtime — the Stripe SDK
// uses Node crypto APIs that aren't available on the edge runtime.
// We also force-dynamic to opt out of any caching, and disable body
// parsing because Stripe requires the raw body bytes for signature
// verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return errorResponse("Missing stripe-signature header", 400);
  }

  try {
    await billingService.handleWebhook(payload, signature);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook error";
    // 400 tells Stripe not to retry on a permanently bad event
    // (e.g. signature mismatch). 500 would tell it to retry — and
    // re-send the same event, which is exactly what idempotency
    // protects against on retries but you don't want a 500 storm.
    return errorResponse(message, 400);
  }
}
