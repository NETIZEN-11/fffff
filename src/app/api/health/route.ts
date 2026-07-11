import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const start = Date.now();

  try {
    // Check DB connectivity
    await db.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - start;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "1.0.0",
      checks: {
        database: { status: "healthy", latencyMs: dbLatency },
      },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        checks: { database: { status: "unhealthy" } },
      },
      { status: 503 }
    );
  }
}
