import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  errorResponse,
  validationErrorResponse,
} from "@/shared/utils/api-response";
import { ZodError } from "zod";

const schema = z.object({ code: z.string().min(1) });

// POST /api/v1/referrals/apply — called after signup to apply referral code
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const body = await req.json();
    const { code } = schema.parse(body);

    // Check user hasn't already been referred
    const alreadyReferred = await db.referral.findFirst({
      where: { referredId: session.user.id },
    });
    if (alreadyReferred) {
      return errorResponse("You have already applied a referral code.", 409);
    }

    // Find the open referral
    const referral = await db.referral.findUnique({ where: { code } });
    if (!referral) return errorResponse("Invalid referral code.", 404);
    if (referral.referrerId === session.user.id) {
      return errorResponse("You cannot use your own referral code.", 400);
    }
    if (referral.referredId !== null) {
      return errorResponse("This referral code has already been used.", 409);
    }

    // Apply referral in a transaction
    await db.$transaction(async (tx) => {
      // Mark referral as converted
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          referredId: session.user.id,
          status: "CONVERTED",
          convertedAt: new Date(),
        },
      });

      // Give bonus analyses to the new user (referred)
      await tx.subscription.update({
        where: { userId: session.user.id },
        data: { analysesLimit: { increment: referral.referredBonus } },
      });

      // Give bonus analyses to the referrer
      await tx.subscription.update({
        where: { userId: referral.referrerId },
        data: { analysesLimit: { increment: referral.referrerBonus } },
      });

      // Mark as rewarded
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: "REWARDED" },
      });

      // Notify referrer
      await tx.notification.create({
        data: {
          userId: referral.referrerId,
          type: "SYSTEM",
          title: "Referral Bonus Earned!",
          message: `Someone signed up with your referral link. You've earned ${referral.referrerBonus} extra analyses!`,
          metadata: { bonus: referral.referrerBonus },
        },
      });

      // Notify new user
      await tx.notification.create({
        data: {
          userId: session.user.id,
          type: "SYSTEM",
          title: "Referral Bonus Applied!",
          message: `Welcome bonus: ${referral.referredBonus} extra analyses have been added to your account.`,
          metadata: { bonus: referral.referredBonus },
        },
      });
    });

    return successResponse(
      { bonusEarned: referral.referredBonus },
      `Referral applied! You've received ${referral.referredBonus} bonus analyses.`
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
