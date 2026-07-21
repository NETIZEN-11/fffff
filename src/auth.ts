import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { loginSchema } from "@/modules/auth/schemas/auth.schema";
import type { UserRole } from "@prisma/client";
import { jwtVerify } from "jose";

const IMPERSONATION_COOKIE = "rr_impersonate";

// Secret for signing impersonation tokens - MUST be set in environment
if (!process.env.IMPERSONATION_SECRET) {
  throw new Error(
    "IMPERSONATION_SECRET environment variable is required. Generate one with: openssl rand -base64 32"
  );
}
const IMPERSONATION_SECRET = new TextEncoder().encode(process.env.IMPERSONATION_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
    verifyRequest: "/auth/verify",
    newUser: "/onboarding",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const validated = loginSchema.safeParse(credentials);
        if (!validated.success) return null;

        const { email, password } = validated.data;

        const user = await db.user.findUnique({
          where: { email, deletedAt: null },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
            role: true,
            isActive: true,
            isBanned: true,
            emailVerified: true,
          },
        });

        if (!user || !user.passwordHash) return null;
        if (!user.isActive || user.isBanned) return null;

        // Block sign-in if email not yet verified
        if (!user.emailVerified) {
          // Throw so Auth.js surfaces the error= param on the error page
          throw new Error("EmailNotVerified");
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) return null;

        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: UserRole }).role ?? "USER";
      }

      // Handle session update
      if (trigger === "update" && session) {
        token.name = session.name;
        token.image = session.image;
      }

      // Skip database checks in Next.js Edge Middleware runtime (where Prisma isn't supported)
      if (process.env.NEXT_RUNTIME === "edge") {
        return token;
      }

      // ── Impersonation check ──────────────────────────────────────────────
      try {
        const cookieStore = await cookies();
        const impCookie = cookieStore.get(IMPERSONATION_COOKIE)?.value;
        if (impCookie) {
          // Verify the signed JWT token
          const { payload } = await jwtVerify(impCookie, IMPERSONATION_SECRET);
          
          const targetUserId = payload.targetUserId as string;
          const adminId = payload.adminId as string;
          const expiresAt = payload.exp! * 1000; // JWT exp is in seconds

          if (Date.now() < expiresAt) {
            // Verify the real admin token belongs to the adminId in cookie
            const realId = token.id as string | undefined;
            if (realId === adminId || token.adminId === adminId) {
              const target = await db.user.findUnique({
                where: { id: targetUserId, deletedAt: null },
                select: { id: true, name: true, email: true, image: true, role: true },
              });
              if (target) {
                return {
                  ...token,
                  id: target.id,
                  name: target.name,
                  email: target.email,
                  image: target.image,
                  role: target.role,
                  adminId: adminId, // preserve so we can stop impersonation
                  isImpersonating: true,
                };
              }
            }
          }
        }
      } catch {
        // Cookie read/verification failure — fall through to normal flow
        // This catches both missing cookies and tampered/invalid signatures
      }
      // ─────────────────────────────────────────────────────────────────────

      // Refresh role from DB on every access
      if (token.id) {
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isActive: true, isBanned: true },
        });

        if (!dbUser || !dbUser.isActive || dbUser.isBanned) {
          return { ...token, error: "AccessDenied" };
        }

        token.role = dbUser.role;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.error === "AccessDenied") {
        session.user.id = "";
        return session;
      }
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;
      // Expose impersonation state to the client session
      if (token.isImpersonating) {
        (session as typeof session & { isImpersonating?: boolean; adminId?: string }).isImpersonating = true;
        (session as typeof session & { isImpersonating?: boolean; adminId?: string }).adminId = token.adminId as string;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Allow OAuth sign-ins
      if (account?.provider !== "credentials") {
        return true;
      }

      // Credentials sign-in is already validated in authorize()
      return !!user;
    },
  },
  events: {
    async createUser({ user }) {
      // Auto-create profile and free subscription for OAuth signups
      // (credentials signups already do this in authRepository.createUser)
      if (user.id) {
        await db.profile.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id },
        });
        await db.subscription.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            plan: "FREE",
            analysesLimit: 3,
          },
        });

        // Trigger Inngest welcome email (5-min delay) for OAuth signups
        // Credentials signups already trigger this in authService.register()
        if (user.email) {
          inngest
            .send({
              name: "email/send-welcome",
              data: {
                userId: user.id,
                email: user.email,
                name: user.name ?? "",
              },
            })
            .catch(() => {
              console.error("Failed to queue welcome email for OAuth user:", user.email);
            });
        }
      }
    },
  },
});
