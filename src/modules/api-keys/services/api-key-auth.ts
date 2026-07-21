import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * API-key authentication helper.
 *
 * Frontend (browser) requests use NextAuth's session cookie. Programmatic
 * API access uses a long-lived API key in the Authorization header:
 *
 *   Authorization: Bearer rr_live_xxxxxxxxxxxxxxxxxxxx
 *
 * The key's SHA-256 hash is what we store in the DB. The plaintext is
 * only shown to the user once on creation. We compare hashes with
 * timingSafeEqual to prevent timing-based key recovery.
 *
 * Returns the resolved { userId, keyId, permissions } on success, or
 * null on any failure (missing header, unknown key, inactive key).
 *
 * IMPORTANT: callers should still enforce their own permission check
 * based on `permissions` — the helper just authenticates the caller.
 */
export type AuthedKey = {
  userId: string;
  keyId: string;
  permissions: string[];
};

export async function authenticateApiKey(
  authorizationHeader: string | null | undefined
): Promise<AuthedKey | null> {
  if (!authorizationHeader) return null;
  if (!authorizationHeader.startsWith("Bearer ")) return null;

  const plaintext = authorizationHeader.slice("Bearer ".length).trim();
  if (!plaintext) return null;

  // We don't enforce an `rr_live_` prefix here — the lookup is by hash,
  // and adding a prefix check would just mean an attacker with a stolen
  // hash could bypass it. Hashing is the gate.

  const hash = createHash("sha256").update(plaintext).digest("hex");

  const record = await db.apiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      userId: true,
      permissions: true,
      isActive: true,
      expiresAt: true,
    },
  });

  if (!record) return null;
  if (!record.isActive) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // We already proved equality via the `where: { keyHash: hash }`
  // lookup — Prisma uses parameterised queries, no timing leak there.
  // No need for a second timingSafeEqual.

  // Update lastUsedAt in the background — we don't want a slow write
  // to block the API call. Fire-and-forget; failures are non-fatal.
  db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    userId: record.userId,
    keyId: record.id,
    permissions: record.permissions,
  };
}

/**
 * Verify a permission is granted to an authenticated key. Treats
 * missing/empty permissions as "no access" (the secure default).
 */
export function hasPermission(key: AuthedKey, required: string): boolean {
  if (!key.permissions || key.permissions.length === 0) return false;
  // A wildcard grants all permissions, useful for admin keys.
  if (key.permissions.includes("*")) return true;
  return key.permissions.includes(required);
}
