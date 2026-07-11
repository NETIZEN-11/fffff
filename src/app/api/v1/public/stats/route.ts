import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Cache: revalidate every 1 hour — public, no auth needed
export const revalidate = 3600;

export async function GET() {
  try {
    const [totalUsers, totalAnalyses, avgAtsResult] = await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.resumeAnalysis.count({ where: { deletedAt: null, status: "COMPLETED" } }),
      db.resumeAnalysis.aggregate({
        where: { status: "COMPLETED", deletedAt: null },
        _avg: { atsScore: true },
      }),
    ]);

    const avgAtsScore = Math.round(avgAtsResult._avg.atsScore ?? 0);

    return NextResponse.json(
      {
        success: true,
        data: {
          totalUsers,
          totalAnalyses,
          avgAtsScore,
        },
      },
      {
        headers: {
          // Allow public CDN caching for 1 hour
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch {
    // On error, return null so the homepage falls back to defaults gracefully
    return NextResponse.json(
      { success: false, data: null },
      { status: 500 }
    );
  }
}
