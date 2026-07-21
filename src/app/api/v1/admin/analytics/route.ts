import { auth } from "@/auth";
import { db } from "@/lib/db";
import { successResponse, errorResponse } from "@/shared/utils/api-response";

export async function GET() {
  const session = await auth();

  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN")) {
    return errorResponse("Unauthorized", 403);
  }

  try {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    // Total users
    const totalUsers = await db.user.count({
      where: { deletedAt: null },
    });

    // New users this month
    const newUsersThisMonth = await db.user.count({
      where: {
        deletedAt: null,
        createdAt: { gte: thisMonthStart },
      },
    });

    // New users last month (for growth calculation)
    const newUsersLastMonth = await db.user.count({
      where: {
        deletedAt: null,
        createdAt: { gte: lastMonthStart, lt: thisMonthStart },
      },
    });

    // Calculate growth percentage
    const userGrowthPct =
      newUsersLastMonth > 0
        ? Math.round(((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100)
        : newUsersThisMonth > 0
        ? 100
        : 0;

    // Total analyses
    const totalAnalyses = await db.resumeAnalysis.count({
      where: { deletedAt: null },
    });

    // Analyses this month
    const analysesThisMonth = await db.resumeAnalysis.count({
      where: {
        deletedAt: null,
        createdAt: { gte: thisMonthStart },
      },
    });

    // Average ATS score (completed analyses only)
    const atsScoreAvg = await db.resumeAnalysis.aggregate({
      where: {
        deletedAt: null,
        status: "COMPLETED",
        atsScore: { not: null },
      },
      _avg: { atsScore: true },
    });

    const averageAtsScore = Math.round(atsScoreAvg._avg.atsScore ?? 0);

    // Revenue calculation (sum of successful payments)
    const paymentsSum = await db.payment.aggregate({
      where: { status: "succeeded" },
      _sum: { amount: true },
    });

    // Convert from cents to dollars
    const totalRevenue = Math.round((paymentsSum._sum.amount ?? 0) / 100);

    // Active subscriptions (ACTIVE or TRIALING)
    const activeSubscriptions = await db.subscription.count({
      where: {
        status: { in: ["ACTIVE", "TRIALING"] },
        plan: { in: ["PRO", "TEAM"] },
      },
    });

    // User growth over last 12 months
    const userGrowthData = await db.$queryRaw<
      { month: string; count: number }[]
    >`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YY') as month,
        COUNT(*)::integer as count
      FROM "users"
      WHERE "createdAt" >= ${twelveMonthsAgo}
        AND "deletedAt" IS NULL
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `;

    return successResponse({
      totalUsers,
      newUsersThisMonth,
      userGrowthPct,
      totalAnalyses,
      analysesThisMonth,
      averageAtsScore,
      totalRevenue,
      activeSubscriptions,
      userGrowth: userGrowthData,
    });
  } catch (error) {
    console.error("Admin analytics error:", error);
    return errorResponse("Failed to fetch analytics", 500);
  }
}
