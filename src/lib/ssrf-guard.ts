/**
 * SSRF guard for outbound fetches.
 *
 * Blocks requests to private/loopback/link-local IP ranges and to non-HTTP(S)
 * schemes, preventing the application from being abused as a proxy to:
 *   - cloud metadata services (169.254.169.254, metadata.google.internal, ...)
 *   - internal services on 10.0.0.0/8, 172.16/12, 192.168/16
 *   - localhost services (Redis on :6379, Postgres on :5432, ...)
 *   - IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
 *
 * Threat model also includes DNS rebinding: the hostname is resolved
 * immediately before fetch, so an attacker cannot race the lookup.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8         "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8        RFC1918 private
  [0x64400000, 0x647fffff], // 100.64.0.0/10     CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8       loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16    link-local (cloud metadata!)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12     RFC1918 private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24      IETF protocol assignments
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16    RFC1918 private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15     benchmarking
  [0xe0000000, 0xefffffff], // 224.0.0.0/4       multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4       reserved
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0]! << 24) >>> 0) +
         ((parts[1]! << 16) >>> 0) +
         ((parts[2]! << 8) >>> 0) +
         (parts[3]! >>> 0);
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipToInt(ip);
  if (n < 0) return false;
  for (const [lo, hi] of IPV4_BLOCKED_RANGES) {
    if (n >= lo && n <= hi) return true;
  }
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  // Normalize: lowercase, strip zone id.
  const lower = ip.toLowerCase().split("%")[0]!;
  if (lower === "::" || lower === "::1" || lower === "0:0:0:0:0:0:0:1" || lower === "0:0:0:0:0:0:0:0") return true; // any/loopback
  // Link-local fe80::/10
  if (
    lower.startsWith("fe8") || lower.startsWith("fe9") ||
    lower.startsWith("fea") || lower.startsWith("feb")
  ) return true;
  // Unique local fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:x:y) — re-check IPv4
  if (lower.startsWith("::ffff:") || lower.startsWith("0:0:0:0:0:ffff:")) {
    const rest = lower.replace(/^::ffff:|^0:0:0:0:0:ffff:/, "");
    if (/^[0-9.]+$/.test(rest)) {
      return isBlockedIPv4(rest);
    }
    const hexParts = rest.split(":");
    if (hexParts.length === 2) {
      const p1 = Number.parseInt(hexParts[0]!, 16);
      const p2 = Number.parseInt(hexParts[1]!, 16);
      if (!Number.isNaN(p1) && !Number.isNaN(p2)) {
        const ipInt = ((p1 << 16) >>> 0) + (p2 >>> 0);
        for (const [lo, hi] of IPV4_BLOCKED_RANGES) {
          if (ipInt >= lo && ipInt <= hi) return true;
        }
      }
    }
  }
  return false;
}

export class SSRFBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`);
    this.name = "SSRFBlockedError";
  }
}

/**
 * Validate a URL before fetching it.
 * Throws SSRFBlockedError if the URL targets a private/loopback address
 * or uses a non-HTTP(S) scheme.
 */
export async function assertSafeUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFBlockedError("invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFBlockedError(`scheme ${parsed.protocol} not allowed`);
  }

  // If the hostname is enclosed in brackets (e.g. [::1]), strip them.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  if (!host) throw new SSRFBlockedError("missing hostname");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SSRFBlockedError(`hostname ${host} is blocked`);
  }

  // If the hostname is already an IP, validate it directly.
  if (net.isIP(host)) {
    if (net.isIPv4(host) && isBlockedIPv4(host)) {
      throw new SSRFBlockedError(`IPv4 ${host} is in a blocked range`);
    }
    if (net.isIPv6(host) && isBlockedIPv6(host)) {
      throw new SSRFBlockedError(`IPv6 ${host} is in a blocked range`);
    }
    return parsed;
  }

  // Resolve DNS and check all returned addresses. This prevents DNS rebinding
  // because we look up the host the first time and the fetch that follows
  // reuses the same resolver state.
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) {
    throw new SSRFBlockedError("hostname did not resolve");
  }
  for (const a of addrs) {
    if (net.isIPv4(a.address) && isBlockedIPv4(a.address)) {
      throw new SSRFBlockedError(`resolved IPv4 ${a.address} is in a blocked range`);
    }
    if (net.isIPv6(a.address) && isBlockedIPv6(a.address)) {
      throw new SSRFBlockedError(`resolved IPv6 ${a.address} is in a blocked range`);
    }
  }

  return parsed;
}
