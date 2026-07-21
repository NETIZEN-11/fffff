/**
 * Environment validation - imports env.ts to trigger validation
 * This file should be imported in app layout or API routes, NOT in middleware
 * (middleware runs in Edge runtime which doesn't support all Node.js APIs)
 */
import { env } from "./env";

// Re-export for convenience
export { env };
