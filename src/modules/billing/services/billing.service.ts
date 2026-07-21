import { stripe, STRIPE_PLANS } from "@/lib/stripe";
import { db } from "@/lib/db";
import { APP_URL } from "@/constants";
import { logger } from "@/lib/logger";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";

/**
 * Map a Stripe subscription.status string to the local SubscriptionStatus
 * enum. Stripe statuses are lowercase, our enum is uppercase. The previous
 * code did `.toUpperCase() as "ACTIVE"` which lied to the type-checker:
 * "PAST_DUE".toUpperCase() === "PAST_DUE" is fine, but the assertion
 * forced it back to "ACTIVE" typewise, hiding bugs.
 */
function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE";
    case "unpaid":
      return "UNPAID";
    case "paused":
      return "PAST_DUE"; // treat paused as past-due locally
    default:
      return "INCOMPLETE";
  }
}

export class BillingService {
  async getOrCreateCustomer(userId: string): Promise<string> {
    const subscription = await db.subscription.findUnique({
      where: { userId },
      include: { user: { select: { email: true, name: true } } },
    });

    if (!subscription) throw new Error("Subscription record not found");

    if (subscription.stripeCustomerId) {
      return subscription.stripeCustomerId;
    }

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: subscription.user.email,
      name: subscription.user.name ?? undefined,
      metadata: { userId },
    });

    await db.subscription.update({
      where: { userId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  async createCheckoutSession(
    userId: string,
    plan: "PRO" | "TEAM"
  ): Promise<string> {
    const customerId = await this.getOrCreateCustomer(userId);
    const planConfig = STRIPE_PLANS[plan];

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${APP_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/billing?canceled=true`,
      metadata: { userId, plan },
      subscription_data: {
        metadata: { userId, plan },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error("Failed to create checkout session");
    return session.url;
  }

  async createPortalSession(userId: string): Promise<string> {
    const customerId = await this.getOrCreateCustomer(userId);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/billing`,
    });

    return session.url;
  }

  async handleWebhook(payload: string, signature: string): Promise<void> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch {
      throw new Error("Invalid webhook signature");
    }

    // Idempotency: Stripe sends the same event more than once on 5xx.
    // Record event.id in stripe_events; if we've already processed it,
    // bail before mutating anything.
    const existing = await db.stripeEvent.findUnique({ where: { id: event.id } });
    if (existing?.status === "processed") {
      logger.info(
        { eventId: event.id, type: event.type },
        "Stripe event already processed, skipping"
      );
      return;
    }

    // Mark as pending (upsert so we don't crash on the first delivery
    // but still record the attempt for forensics)
    await db.stripeEvent.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        type: event.type,
        status: "pending",
      },
    });

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case "checkout.session.async_payment_succeeded":
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case "checkout.session.async_payment_failed":
          // Notify user that their payment method failed
          await this.handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case "customer.subscription.deleted":
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case "customer.subscription.paused":
        case "customer.subscription.resumed":
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case "customer.subscription.trial_will_end":
          await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
          break;
        case "invoice.payment_succeeded":
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;
        case "invoice.payment_failed":
          await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case "charge.refunded":
          await this.handleRefund(event.data.object as Stripe.Charge);
          break;
        case "customer.updated":
          await this.handleCustomerUpdated(event.data.object as Stripe.Customer);
          break;
        default:
          // Unhandled events are not errors — Stripe sends many we don't care about
          logger.info({ type: event.type }, "Unhandled Stripe event type");
      }

      await db.stripeEvent.update({
        where: { id: event.id },
        data: { status: "processed", processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.stripeEvent.update({
        where: { id: event.id },
        data: { status: "failed", error: message },
      });
      // Re-throw so the route returns 500 and Stripe retries.
      throw err;
    }
  }

  private async handleAsyncPaymentFailed(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.userId;
    if (!userId) return;
    await db.notification.create({
      data: {
        userId,
        type: "SUBSCRIPTION_UPDATED",
        title: "Payment failed",
        message: "Your payment could not be processed. Please update your payment method to activate your subscription.",
      },
    });
  }

  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata?.userId;
    if (!userId) return;
    const trialEnd = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;
    await db.notification.create({
      data: {
        userId,
        type: "SUBSCRIPTION_UPDATED",
        title: "Trial ending soon",
        message: trialEnd
          ? `Your free trial ends on ${trialEnd.toLocaleDateString()}. Add a payment method to continue.`
          : "Your free trial is ending soon. Add a payment method to continue.",
      },
    });
  }

  private async handleRefund(charge: Stripe.Charge): Promise<void> {
    if (!charge.payment_intent) return;
    const payment = await db.payment.findUnique({
      where: { stripePaymentIntentId: charge.payment_intent as string },
    });
    if (!payment) return;
    // Mark the payment record as refunded. Refund itself doesn't change
    // the subscription — Stripe handles that via subscription.deleted.
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "refunded",
        metadata: {
          ...(payment.metadata as Record<string, unknown> | null) ?? {},
          refundedAmount: charge.amount_refunded,
        },
      },
    });
    await db.notification.create({
      data: {
        userId: payment.userId,
        type: "SUBSCRIPTION_UPDATED",
        title: "Refund processed",
        message: `A refund of $${(charge.amount_refunded / 100).toFixed(2)} has been issued.`,
      },
    });
  }

  private async handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
    if (!customer.email) return;
    const user = await db.user.findFirst({
      where: { email: customer.email, deletedAt: null },
    });
    if (!user) return;
    await db.user.update({
      where: { id: user.id },
      data: {
        name: customer.name ?? user.name,
      },
    });
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan as "PRO" | "TEAM";

    if (!userId || !plan) return;

    const planConfig = STRIPE_PLANS[plan];

    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );

      // Defensive: items can be missing on a half-constructed
      // subscription. Falling back to subscription_data's price id
      // avoids a null-pointer crash mid-checkout.
      const priceId =
        subscription.items?.data[0]?.price?.id ??
        planConfig.priceId;

      await db.subscription.update({
        where: { userId },
        data: {
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          plan: plan,
          status: mapStripeStatus(subscription.status),
          analysesLimit: planConfig.analysesLimit,
          analysesUsed: 0,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { role: plan === "PRO" ? "PRO" : "TEAM_ADMIN" },
      });

      // Create notification
      await db.notification.create({
        data: {
          userId,
          type: "SUBSCRIPTION_UPDATED",
          title: "Subscription Activated",
          message: `Welcome to ${planConfig.name}! Enjoy unlimited analyses.`,
        },
      });
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata?.userId;
    if (!userId) return;

    const newStatus = mapStripeStatus(subscription.status);

    // Downgrade: subscription is no longer paying (canceled/unpaid).
    // Bring the user back to FREE so they hit the quota instead of
    // running unlimited analyses on a dead subscription. We also
    // clear the cached Stripe IDs — a fresh upgrade will mint new ones.
    if (newStatus === "CANCELED" || newStatus === "UNPAID" || newStatus === "INCOMPLETE") {
      await db.subscription.update({
        where: { userId },
        data: {
          plan: "FREE",
          status: newStatus,
          analysesLimit: 3,
          analysesUsed: 0,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      });
      await db.user.update({ where: { id: userId }, data: { role: "USER" } });
      return;
    }

    await db.subscription.update({
      where: { userId },
      data: {
        status: newStatus,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata?.userId;
    if (!userId) return;

    await db.subscription.update({
      where: { userId },
      data: {
        plan: "FREE",
        status: "CANCELED",
        analysesLimit: 3,
        analysesUsed: 0,
        stripeSubscriptionId: null,
        stripePriceId: null,
      },
    });

    await db.user.update({
      where: { id: userId },
      data: { role: "USER" },
    });

    // Notify so the user isn't confused when the next page load shows
    // the FREE plan.
    await db.notification.create({
      data: {
        userId,
        type: "SUBSCRIPTION_UPDATED",
        title: "Subscription canceled",
        message:
          "Your subscription has been canceled. You're back on the FREE plan. Re-subscribe any time from the billing page.",
      },
    });
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;
    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!subscription) return;

    // billing_reason tells us WHY Stripe is sending this invoice.
    // "subscription_cycle" = periodic renewal — the start of a new
    //   billing period, so it's correct to reset the monthly counter.
    // "subscription_create" = first invoice; we reset because the
    //   counter is already 0 in that case, but it's a no-op.
    // "manual" / "subscription_update" / "subscription_threshold" /
    // "subscription_update" = mid-cycle adjustments. We must NOT reset
    //   the counter or the user would get a fresh quota on a proration.
    const isPeriodBoundary =
      invoice.billing_reason === "subscription_cycle" ||
      invoice.billing_reason === "subscription_create";

    if (isPeriodBoundary) {
      await db.subscription.update({
        where: { id: subscription.id },
        data: { analysesUsed: 0, status: "ACTIVE" },
      });
    } else {
      // Mid-cycle retry success — just clear past-due if needed.
      if (subscription.status === "PAST_DUE") {
        await db.subscription.update({
          where: { id: subscription.id },
          data: { status: "ACTIVE" },
        });
      }
    }

    // Record payment (idempotent on payment_intent id)
    if (invoice.payment_intent) {
      await db.payment.upsert({
        where: { stripePaymentIntentId: invoice.payment_intent as string },
        update: {},
        create: {
          userId: subscription.userId,
          stripePaymentIntentId: invoice.payment_intent as string,
          stripeInvoiceId: invoice.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          status: "succeeded",
          description: invoice.description ?? "Subscription payment",
        },
      });
    }
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;
    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!subscription) return;

    await db.subscription.update({
      where: { id: subscription.id },
      data: { status: "PAST_DUE" },
    });

    // Notify the user — they need to update their card or the
    // subscription will be canceled by Stripe after the dunning window.
    await db.notification.create({
      data: {
        userId: subscription.userId,
        type: "SUBSCRIPTION_UPDATED",
        title: "Payment failed",
        message:
          "We couldn't process your latest payment. Update your payment method to keep your subscription active.",
      },
    });
  }

  async getSubscription(userId: string) {
    return db.subscription.findUnique({ where: { userId } });
  }

  async getPaymentHistory(userId: string) {
    return db.payment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }
}

export const billingService = new BillingService();
