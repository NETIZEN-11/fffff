import { stripe, STRIPE_PLANS } from "@/lib/stripe";
import { db } from "@/lib/db";
import { APP_URL } from "@/constants";
import type Stripe from "stripe";

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

    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_succeeded":
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
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

      await db.subscription.update({
        where: { userId },
        data: {
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.items.data[0]?.price.id,
          plan: plan,
          status: "ACTIVE",
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

    await db.subscription.update({
      where: { userId },
      data: {
        status: subscription.status.toUpperCase() as "ACTIVE",
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
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;
    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!subscription) return;

    // Reset monthly usage on renewal
    await db.subscription.update({
      where: { id: subscription.id },
      data: { analysesUsed: 0, status: "ACTIVE" },
    });

    // Record payment
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
