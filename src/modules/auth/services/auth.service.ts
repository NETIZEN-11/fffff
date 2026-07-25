import { authRepository } from "@/modules/auth/repositories/auth.repository";
import { resend, EMAIL_CONFIG } from "@/lib/resend";
import { inngest } from "@/lib/inngest";
import { APP_URL } from "@/constants";
import { db } from "@/lib/db";
import crypto from "crypto";

export class AuthService {
  async register(data: { name: string; email: string; password: string }) {
    const emailTaken = await authRepository.isEmailTaken(data.email);
    if (emailTaken) {
      throw new Error("An account with this email already exists");
    }

    if (!data.password || data.password.length < 8) {
      throw new Error("Password must be at least 8 characters long");
    }

    const user = await authRepository.createUser(data);

    // Send email verification (non-blocking)
    this.sendVerificationEmail(user.email, user.name ?? "").catch(() => {
      console.error("Failed to send verification email for:", user.email);
    });

    // Trigger Inngest welcome email job (5-min delayed, via background queue)
    inngest
      .send({
        name: "email/send-welcome",
        data: { userId: user.id, email: user.email, name: user.name ?? "" },
      })
      .catch(() => {
        console.error("Failed to queue welcome email job for:", user.email);
      });

    return user;
  }

  async sendVerificationEmail(email: string, name: string): Promise<void> {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Upsert so re-sending always creates a fresh token
    await db.verificationToken.upsert({
      where: {
        identifier_token: {
          identifier: email,
          token: `verify_${token}`,
        },
      },
      update: { expires },
      create: {
        identifier: email,
        token: `verify_${token}`,
        expires,
      },
    });

    const verifyUrl = `${APP_URL}/api/v1/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

    await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      subject: "Verify your ResumeRank AI email address",
      html: this.verificationEmailHtml(name, verifyUrl),
    });
  }

  async verifyEmail(email: string, token: string): Promise<void> {
    const record = await db.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token: `verify_${token}`,
        },
      },
    });

    if (!record) throw new Error("Invalid or expired verification link.");
    if (new Date() > record.expires) {
      await db.verificationToken.delete({
        where: { identifier_token: { identifier: email, token: `verify_${token}` } },
      });
      throw new Error("Verification link has expired. Please request a new one.");
    }

    const user = await authRepository.findByEmail(email);
    if (!user) throw new Error("Account not found.");

    // Mark email as verified
    await authRepository.verifyEmail(user.id);

    // Clean up the token
    await db.verificationToken.delete({
      where: { identifier_token: { identifier: email, token: `verify_${token}` } },
    });
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    // Always return silently to avoid email enumeration
    if (!user || user.emailVerified) return;
    await this.sendVerificationEmail(email, user.name ?? "");
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.verificationToken.upsert({
      where: {
        identifier_token: {
          identifier: email,
          token: `reset_${token}`,
        },
      },
      update: { expires },
      create: {
        identifier: email,
        token: `reset_${token}`,
        expires,
      },
    });

    const resetUrl = `${APP_URL}/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      subject: "Reset your ResumeRank AI password",
      html: this.resetPasswordEmailHtml(user.name ?? "", resetUrl),
    });
  }

  async resetPassword(email: string, token: string, password: string): Promise<void> {
    const verificationToken = await db.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token: `reset_${token}`,
        },
      },
    });

    if (!verificationToken) {
      throw new Error("Invalid or expired reset token");
    }

    if (new Date() > verificationToken.expires) {
      await db.verificationToken.delete({
        where: {
          identifier_token: { identifier: email, token: `reset_${token}` },
        },
      });
      throw new Error("Reset token has expired");
    }

    const user = await authRepository.findByEmail(email);
    if (!user) throw new Error("User not found");

    await authRepository.updatePassword(user.id, password);

    await db.verificationToken.delete({
      where: {
        identifier_token: { identifier: email, token: `reset_${token}` },
      },
    });
  }

  // ─── Email HTML builders ────────────────────────────────────────────────────

  private verificationEmailHtml(name: string, verifyUrl: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">✦</span>
            </div>
            <span style="font-size: 18px; font-weight: 700; color: #1a1a1a;">ResumeRank AI</span>
          </div>
        </div>
        <h1 style="color: #1a1a1a; font-size: 24px; font-weight: 700; margin: 0 0 8px;">
          Verify your email address
        </h1>
        <p style="color: #6b7280; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
          Hi ${name}, thanks for signing up! Please verify your email to activate your account.
        </p>
        <a href="${verifyUrl}"
           style="display: block; text-align: center; background: #6366f1; color: white; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: 600; margin-bottom: 24px;">
          Verify Email Address →
        </a>
        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
          This link expires in 24 hours. If you didn't create an account, you can ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 32px 0;" />
        <p style="color: #d1d5db; font-size: 12px; text-align: center; margin: 0;">
          ResumeRank AI · <a href="${APP_URL}" style="color: #d1d5db;">${APP_URL}</a>
        </p>
      </div>
    `;
  }

  private resetPasswordEmailHtml(name: string, resetUrl: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">✦</span>
            </div>
            <span style="font-size: 18px; font-weight: 700; color: #1a1a1a;">ResumeRank AI</span>
          </div>
        </div>
        <h1 style="color: #1a1a1a; font-size: 24px; font-weight: 700; margin: 0 0 8px;">
          Reset your password
        </h1>
        <p style="color: #6b7280; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
          Hi ${name}, we received a request to reset your password. Click the button below to proceed.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 16px; margin-top: 20px;">
          Reset Password
        </a>
        <p style="color: #888; font-size: 14px; margin-top: 20px;">
          This link expires in 1 hour. If you didn't request this, ignore this email.
        </p>
      </div>
    `;
  }
}

export const authService = new AuthService();
