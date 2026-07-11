import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/shared/utils/api-response";

function isAdmin(role: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();
  if (!isAdmin(session.user.role ?? "")) return forbiddenResponse();

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalUsers,
      newUsersThisMonth,
      newUsersLastMonth,
      totalAnalyses,
      analysesThisMonth,
      avgAtsScore,
      totalRevenue,
      activeSubscriptions,
    ] = await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.user.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth } } }),
      db.user.count({
        where: { deletedAt: null, createdAt: { gte: lastMonth, lte: endOfLastMonth } },
      }),
      db.resumeAnalysis.count({ where: { deletedAt: null } }),
      db.resumeAnalysis.count({
        where: { deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      db.resumeAnalysis.aggregate({
        where: { status: "COMPLETED", deletedAt: null },
        _avg: { atsScore: true },
      }),
      db.payment.aggregate({
        where: { status: "succeeded" },
        _sum: { amount: true },
      }),
      db.subscription.count({
        where: { status: "ACTIVE", plan: { not: "FREE" } },
      }),
    ]);

    // User growth trend (last 12 months)
    const userGrowth = await db.$queryRaw<{ month: string; count: number }[]>`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') as month,
        COUNT(*)::int as count
      FROM users
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
        AND "deletedAt" IS NULL
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY month ASC
    `;

    return successResponse(
      {
        totalUsers,
        newUsersThisMonth,
        userGrowthPct:
          newUsersLastMonth > 0
            ? Math.round(((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100)
            : 0,
        totalAnalyses,
        analysesThisMonth,
        averageAtsScore: Math.round(avgAtsScore._avg.atsScore ?? 0),
        totalRevenue: (totalRevenue._sum.amount ?? 0) / 100, // cents to dollars
        activeSubscriptions,
        userGrowth,
      },
      "Admin analytics retrieved"
    );
  } catch (error) {
    return handleApiError(error);
  }
}
