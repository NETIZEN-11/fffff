/**
 * Small, safe helpers for parsing query parameters and request bodies.
 *
 * The native parseInt() returns NaN on bad input — and NaN propagates
 * silently into Prisma (which throws "Invalid value: NaN" deep in a
 * stack trace, not at the param boundary). Use these to fail at the
 * boundary with a clear 400.
 */

export function parsePagination(
  searchParams: URLSearchParams,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {}
): { page: number; pageSize: number } {
  const { page: defaultPage = 1, pageSize: defaultPageSize = 20, maxPageSize = 100 } = defaults;

  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");

  const page = clampInt(pageRaw, defaultPage, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(pageSizeRaw, defaultPageSize, 1, maxPageSize);

  return { page, pageSize };
}

export function parseIntParam(
  value: string | null | undefined,
  fallback: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
): number {
  return clampInt(value, fallback, min, max);
}

function clampInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
