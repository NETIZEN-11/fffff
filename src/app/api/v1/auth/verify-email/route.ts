import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/modules/auth/services/auth.service";
import { APP_URL } from "@/constants";
import { rateLimit } from "@/shared/utils/rate-limit";

// GET /api/v1/auth/verify-email?token=xxx&email=xxx
// Called from the link in the verification email — redirects browser
export async function GET(req: NextRequest) {
  // Without a rate limit an attacker can brute-force verification
  // tokens (the underlying DB lookup has its own ceiling, but the
  // endpoint shouldn't make it cheap to enumerate). 30/min per IP
  // is generous for a real click flow but stops token-stuffing.
  const limit = await rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!limit.success) {
    return NextResponse.redirect(
      `${APP_URL}/auth/error?error=Verification&reason=rate_limited`
    );
  }

  const { searchParams } = req.nextUrl;
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  if (!token || !email) {
    return NextResponse.redirect(
      `${APP_URL}/auth/error?error=Verification&reason=missing_params`
    );
  }

  try {
    await authService.verifyEmail(email, token);
    // Redirect to sign-in with success message
    return NextResponse.redirect(
      `${APP_URL}/auth/signin?verified=true`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    const encoded = encodeURIComponent(message);
    return NextResponse.redirect(
      `${APP_URL}/auth/error?error=Verification&reason=${encoded}`
    );
  }
}
