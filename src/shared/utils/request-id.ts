import { NextRequest } from "next/server";
import { headers } from "next/headers";

/**
 * Gets the request ID from the current request
 * Request ID is set by middleware for all requests
 *
 * @returns Request ID string for tracing
 */
export async function getRequestId(): Promise<string> {
  const headersList = await headers();
  return headersList.get("x-request-id") || "unknown";
}

/**
 * Gets the request ID from a NextRequest object
 *
 * @param req - NextRequest object
 * @returns Request ID string for tracing
 */
export function getRequestIdFromReq(req: NextRequest): string {
  return req.headers.get("x-request-id") || "unknown";
}

/**
 * Formats a log message with request ID
 *
 * @param requestId - Request ID
 * @param message - Log message
 * @returns Formatted log message
 */
export function formatLogWithRequestId(requestId: string, message: string): string {
  return `[req:${requestId.slice(0, 8)}] ${message}`;
}
