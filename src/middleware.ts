import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_ROUTES = ["/auth/signin", "/auth/signup"];
const ADMIN_ROUTES = ["/admin"];
const PROTECTED_ROUTES = ["/dashboard", "/resumes", "/analyze", "/history", "/billing", "/onboarding", "/settings"];

export default auth(async (req: NextRequest & { auth: { user?: { role?: string } } | null }) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;
  const userRole = session?.user?.role;
  const pathname = nextUrl.pathname;

  // Allow public API routes and static files
  if (
    pathname.startsWith("/api/v1/auth") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }  // Stripe webhook - must be accessible without auth
  if (pathname === "/api/v1/billing/webhook") {
    return NextResponse.next();
  }

  // Rate limiting headers (actual logic in API routes)
  const response = NextResponse.next();

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
