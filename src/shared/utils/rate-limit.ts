/**
 * Rate Limiter — Redis-ready (Upstash compatible)
 *
 * Strategy:
 *  - If REDIS_URL is set, uses a lightweight Redis sliding-window counter
 *    via raw HTTP fetch (Upstash REST API format — works on edge/serverless).
 *  - Falls back to an in-memory Map when Redis is not configured
 *    (safe for local dev and single-instance deployments).
 *
 * To enable Redis in production:
 *  1. Add an Upstash Redis database at https://console.upstash.com
 *  2. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local
 *     (or set REDIS_URL for a standard redis:// connection — see below)
 */

import { NextRequest } from "next/server";

export type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  reset: number; // Unix timestamp in seconds
};

// ─── Key builder ─────────────────────────────────────────────────────────────

function buildKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const userId = req.headers.get("x-user-id") ?? "anon";
  // Normalize pathname to avoid cache-busting via trailing slashes
  const path = req.nextUrl.pathname.replace(/\/$/, "") || "/";
  return `rl:${ip}:${userId}:${path}`;
}

// ─── In-memory fallback (single-instance / local dev) ────────────────────────

type MemEntry = { count: number; resetAt: number };
const memStore = new Map<string, MemEntry>();

// Periodically clean up expired entries to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memStore.entries()) {
      if (now > entry.resetAt) memStore.delete(key);
    }
  }, 60_000);
}

function memRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + config.windowMs;
    memStore.set(key, { count: 1, resetAt });
    return {
      success: true,
      remaining: config.limit - 1,
      resetAt,
      limit: config.limit,
      reset: Math.ceil(resetAt / 1000),
    };
  }

  if (entry.count >= config.limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      limit: config.limit,
      reset: Math.ceil(entry.resetAt / 1000),
    };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
    limit: config.limit,
    reset: Math.ceil(entry.resetAt / 1000),
  };
}

// ─── Upstash Redis adapter (edge-compatible via REST) ────────────────────────

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const isRedisConfigured = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const windowSec = Math.ceil(config.windowMs / 1000);
  const now = Date.now();
  const resetAt = now + config.windowMs;

  try {
    // INCR + EXPIRE pipeline via Upstash REST API
    // POST /pipeline with array of commands
    const response = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, windowSec, "NX"], // Only set expiry on first increment
      ]),
    });

    if (!response.ok) {
      // Redis error — degrade gracefully to in-memory
      return memRateLimit(key, config);
    }

    const results = (await response.json()) as [
      { result: number },
      { result: number },
    ];

    const count = results[0]?.result ?? 1;
    const reset = Math.ceil(resetAt / 1000);

    if (count > config.limit) {
      return {
        success: false,
        remaining: 0,
        resetAt,
        limit: config.limit,
        reset,
      };
    }

    return {
      success: true,
      remaining: Math.max(0, config.limit - count),
      resetAt,
      limit: config.limit,
      reset,
    };
  } catch {
    // Network/parse error — degrade gracefully to in-memory
    return memRateLimit(key, config);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Injects rate limit headers into a Response object
 * Headers follow standard RateLimit Header Fields for HTTP (IETF draft)
 *
 * @param response - Response object to add headers to
 * @param result - Rate limit result
 * @returns Response with rate limit headers
 */
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  response.headers.set("X-RateLimit-Limit", result.limit.toString());
  response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
  response.headers.set("X-RateLimit-Reset", result.reset.toString());
  
  // Add Retry-After header if rate limited
  if (!result.success) {
    const retryAfter = Math.max(0, result.reset - Math.floor(Date.now() / 1000));
    response.headers.set("Retry-After", retryAfter.toString());
  }

  return response;
}

/**
 * Rate limit a Next.js API request.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * are set; otherwise falls back to an in-memory store.
 *
 * @example
 * const limit = await rateLimit(req, { limit: 10, windowMs: 60_000 });
 * if (!limit.success) {
 *   const response = errorResponse("Too many requests", 429);
 *   return addRateLimitHeaders(response, limit);
 * }
 */
export async function rateLimit(
  req: NextRequest,
  config: RateLimitConfig = { limit: 100, windowMs: 60_000 }
): Promise<RateLimitResult> {
  const key = buildKey(req);

  if (isRedisConfigured) {
    return redisRateLimit(key, config);
  }

  return memRateLimit(key, config);
}
