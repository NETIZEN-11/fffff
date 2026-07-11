import { PrismaClient, UserRole, SubscriptionPlan } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Feature flags
  await prisma.featureFlag.upsert({
    where: { key: "enable_ocr" },
    update: {},
    create: {
      key: "enable_ocr",
      name: "Enable OCR",
      description: "Enable OCR for scanned PDF processing",
      isEnabled: false,
      rolloutPct: 0,
    },
  });

  await prisma.featureFlag.upsert({
    where: { key: "enable_team_workspace" },
    update: {},
    create: {
      key: "enable_team_workspace",
      name: "Team Workspace",
      description: "Enable team workspace features",
      isEnabled: true,
      rolloutPct: 100,
    },
  });

  await prisma.featureFlag.upsert({
    where: { key: "enable_career_recommendations" },
    update: {},
    create: {
      key: "enable_career_recommendations",
      name: "Career Recommendations",
      description: "Enable AI career recommendations",
      isEnabled: true,
      rolloutPct: 100,
    },
  });

  // Admin user
  const adminPasswordHash = await bcrypt.hash("Admin@123456", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@resumerank.ai" },
    update: {},
    create: {
      email: "admin@resumerank.ai",
      name: "Platform Admin",
      role: UserRole.ADMIN,
      emailVerified: new Date(),
      passwordHash: adminPasswordHash,
      isActive: true,
    },
  });

  await prisma.profile.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      jobTitle: "Platform Administrator",
    },
  });

  await prisma.subscription.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      plan: SubscriptionPlan.PRO,
      analysesLimit: 999999,
    },
  });

  // Demo user
  const demoPasswordHash = await bcrypt.hash("Demo@123456", 12);
  const demo = await prisma.user.upsert({
    where: { email: "demo@resumerank.ai" },
    update: {},
    create: {
      email: "demo@resumerank.ai",
      name: "Demo User",
      role: UserRole.PRO,
      emailVerified: new Date(),
      passwordHash: demoPasswordHash,
      isActive: true,
    },
  });

  await prisma.profile.upsert({
    where: { userId: demo.id },
    update: {},
    create: {
      userId: demo.id,
      jobTitle: "Software Engineer",
      bio: "Demo account for ResumeRank AI",
    },
  });

  await prisma.subscription.upsert({
    where: { userId: demo.id },
    update: {},
    create: {
      userId: demo.id,
      plan: SubscriptionPlan.PRO,
      analysesLimit: 999,
    },
  });

  console.log("Database seeded successfully.");
  console.log("Admin credentials: admin@resumerank.ai / Admin@123456");
  console.log("Demo credentials: demo@resumerank.ai / Demo@123456");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
