import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/modules/auth/services/auth.service";
import { APP_URL } from "@/constants";

// GET /api/v1/auth/verify-email?token=xxx&email=xxx
// Called from the link in the verification email — redirects browser
export async function GET(req: NextRequest) {
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
