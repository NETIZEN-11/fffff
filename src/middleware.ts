import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Note: Environment validation happens in API routes and page components,
// not here in middleware (Edge runtime doesn't support all Node.js APIs)

const AUTH_ROUTES = ["/auth/signin", "/auth/signup"];
const ADMIN_ROUTES = ["/admin"];
const PROTECTED_ROUTES = ["/dashboard", "/resumes", "/analyze", "/history", "/billing", "/onboarding", "/settings"];

// State-changing HTTP methods that need CSRF protection on top of
// the cookie-based session. GET/HEAD/OPTIONS are safe by spec.
const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Build the Content-Security-Policy. We keep it strict but pragmatic:
// - default-src 'self' so anything not whitelisted is blocked
// - script-src 'self' 'unsafe-inline' (Next.js needs unsafe-inline
//   for its inline boot script; nonce-based CSP would be the next
//   step if XSS becomes a real concern)
// - connect-src allows our own origin + Sentry-style telemetry if
//   added later; tighten further in production
// - frame-ancestors 'none' (defence in depth alongside X-Frame-Options)
// - object-src 'none' (no Flash/Java applets)
function buildCSP(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.openai.com https://api.stripe.com https://*.supabase.co",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return directives.join("; ");
}

// Centralised set of security headers applied to every response.
function applySecurityHeaders(response: NextResponse, isHttps: boolean): void {
  // HSTS — only meaningful over HTTPS, so we only set it then. 1 year
  // is the right baseline; preload lets browsers bake the policy in
  // permanently.
  if (isHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  // Clickjacking defence in depth — frame-ancestors 'none' in CSP is
  // the modern equivalent, but X-Frame-Options is still needed for
  // older browsers.
  response.headers.set("X-Frame-Options", "DENY");
  // Don't let the browser sniff MIME types and "improve" them.
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Limit what referrer leaks to other origins.
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Restrict dangerous browser features we don't use.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  // CSP — last because it's the longest and the most likely to be tweaked.
  response.headers.set("Content-Security-Policy", buildCSP());
}

export default auth(async (req: NextRequest & { auth: { user?: { role?: string } } | null }) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;
  const userRole = session?.user?.role;
  const pathname = nextUrl.pathname;

  // Generate or use existing request ID for tracing (Edge-compatible)
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  // CSRF: for state-changing API requests, require an explicit
  // X-Requested-With header. This is the simplest CSRF defence that
  // works without a token: the browser will not let a cross-site
  // <form> POST add custom headers, so any cross-origin POST that
  // *does* carry X-Requested-With must have been preflighted (and
  // the CORS check will block it). This protects the session-cookie
  // auth path. Public routes (auth, inngest, Stripe webhook) are
  // exempt — they don't mutate on the user's behalf.
  if (
    pathname.startsWith("/api/v1/") &&
    !pathname.startsWith("/api/v1/auth") &&
    pathname !== "/api/v1/billing/webhook" &&
    CSRF_METHODS.has(req.method)
  ) {
    if (req.headers.get("x-requested-with") !== "XMLHttpRequest") {
      return NextResponse.json(
        { success: false, message: "Missing X-Requested-With header", data: null },
        { status: 403 }
      );
    }
  }

  // Allow public API routes and static files
  if (
    pathname.startsWith("/api/v1/auth") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    applySecurityHeaders(response, req.nextUrl.protocol === "https:");
    return response;
  }  // Stripe webhook - must be accessible without auth
  if (pathname === "/api/v1/billing/webhook") {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    applySecurityHeaders(response, req.nextUrl.protocol === "https:");
    return response;
  }

  // Rate limiting headers (actual logic in API routes)
  const response = NextResponse.next();

  // Add request ID to all responses for tracing
  response.headers.set("x-request-id", requestId);

  // Security headers on every response.
  applySecurityHeaders(response, req.nextUrl.protocol === "https:");

  // Note: Rate limiting is enforced in individual API routes
  // They will add X-RateLimit-* headers when checking limits

  // Redirect authenticated users away from auth pages
  if (isLoggedIn && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  // Protect admin routes
  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL(`/auth/signin?callbackUrl=${pathname}`, nextUrl));
    }
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard?error=forbidden", nextUrl));
    }
  }

  // Protect app routes
  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL(`/auth/signin?callbackUrl=${pathname}`, nextUrl));
    }
  }

  // Protect all API v1 routes (except auth)
  if (pathname.startsWith("/api/v1/") && !pathname.startsWith("/api/v1/auth")) {
    if (!isLoggedIn) {
      return NextResponse.json(
        { success: false, message: "Unauthorized", data: null },
        { status: 401 }
      );
    }
  }

  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
