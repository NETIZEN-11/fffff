import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { APP_URL } from "@/constants";
import crypto from "crypto";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
} from "@/shared/utils/api-response";

const REFERRER_BONUS = 3;  // extra analyses for the person who referred
const REFERRED_BONUS = 2;  // extra analyses for the new signup

// GET /api/v1/referrals — get user's referral code + stats
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    // Find or create referral link
    let referral = await db.referral.findFirst({
      where: { referrerId: session.user.id, referredId: null, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!referral) {
      const code = crypto.randomBytes(4).toString("hex"); // 8-char hex
      referral = await db.referral.create({
        data: {
          referrerId: session.user.id,
          code,
          status: "PENDING",
          referrerBonus: REFERRER_BONUS,
          referredBonus: REFERRED_BONUS,
        },
      });
    }

    // Stats: how many successful conversions
    const [totalReferrals, converted, totalBonusEarned] = await Promise.all([
      db.referral.count({ where: { referrerId: session.user.id } }),
      db.referral.count({
        where: { referrerId: session.user.id, status: { in: ["CONVERTED", "REWARDED"] } },
      }),
      db.referral.aggregate({
        where: { referrerId: session.user.id, status: "REWARDED" },
        _sum: { referrerBonus: true },
      }),
    ]);

    return successResponse(
      {
        code: referral.code,
        referralUrl: `${APP_URL}/auth/signup?ref=${referral.code}`,
        totalReferrals,
        converted,
        totalBonusEarned: totalBonusEarned._sum.referrerBonus ?? 0,
        referrerBonus: REFERRER_BONUS,
        referredBonus: REFERRED_BONUS,
      },
      "Referral info retrieved"
    );
  } catch (error) {
    return handleApiError(error);
  }
}
