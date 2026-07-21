import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { authService } from "@/modules/auth/services/auth.service";
import { db } from "@/lib/db";

describe("Authentication Integration Tests", () => {
  let testUserId: string;
  const testEmail = `test-${Date.now()}@example.com`;

  afterAll(async () => {
    // Cleanup: delete test user
    if (testUserId) {
      await db.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
  });

  describe("User Registration", () => {
    it("should register a new user successfully", async () => {
      const result = await authService.register({
        name: "Test User",
        email: testEmail,
        password: "Password123!",
      });

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(testEmail);
      expect(result.user.name).toBe("Test User");
      expect(result.user.role).toBe("USER");
      
      testUserId = result.user.id;

      // Verify profile and subscription were created
      const profile = await db.profile.findUnique({
        where: { userId: testUserId },
      });
      expect(profile).toBeDefined();

      const subscription = await db.subscription.findUnique({
        where: { userId: testUserId },
      });
      expect(subscription).toBeDefined();
      expect(subscription?.plan).toBe("FREE");
      expect(subscription?.analysesLimit).toBe(3);
    });

    it("should not allow duplicate email registration", async () => {
      await expect(
        authService.register({
          name: "Test User 2",
          email: testEmail,
          password: "Password123!",
        })
      ).rejects.toThrow();
    });

    it("should reject weak passwords", async () => {
      await expect(
        authService.register({
          name: "Test User",
          email: `test2-${Date.now()}@example.com`,
          password: "weak",
        })
      ).rejects.toThrow();
    });
  });

  describe("Email Verification", () => {
    it("should generate verification token", async () => {
      const user = await db.user.findUnique({
        where: { email: testEmail },
      });

      const token = await authService.generateVerificationToken(testEmail);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);
    });
  });

  describe("Password Reset", () => {
    it("should generate password reset token", async () => {
      const token = await authService.generateResetToken(testEmail);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
    });
  });
});
