import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// Soft delete middleware - automatically filters out soft-deleted records
// Only initialize in Node.js runtime (not Edge runtime where Prisma isn't supported)
if (process.env.NEXT_RUNTIME !== "edge") {
  db.$use(async (params, next) => {
    // Models that support soft delete
    const softDeleteModels = [
      "User",
      "Resume",
      "ResumeAnalysis",
      "JobDescription",
    ];

    if (softDeleteModels.includes(params.model || "")) {
      // Handle findUnique and findFirst
      if (params.action === "findUnique" || params.action === "findFirst") {
        params.action = "findFirst";
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }

      // Handle findMany
      if (params.action === "findMany") {
        if (params.args.where) {
          if (params.args.where.deletedAt === undefined) {
            params.args.where.deletedAt = null;
          }
        } else {
          params.args.where = { deletedAt: null };
        }
      }

      // Handle count
      if (params.action === "count") {
        if (params.args.where) {
          if (params.args.where.deletedAt === undefined) {
            params.args.where.deletedAt = null;
          }
        } else {
          params.args.where = { deletedAt: null };
        }
      }

      // Handle update - prevent updating deleted records
      if (params.action === "update") {
        params.action = "updateMany";
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }

      // Handle updateMany
      if (params.action === "updateMany") {
        if (params.args.where) {
          params.args.where.deletedAt = null;
        } else {
          params.args.where = { deletedAt: null };
        }
      }

      // Convert delete to soft delete (update deletedAt)
      if (params.action === "delete") {
        params.action = "update";
        params.args.data = { deletedAt: new Date() };
      }

      // Convert deleteMany to soft delete
      if (params.action === "deleteMany") {
        params.action = "updateMany";
        if (params.args.data !== undefined) {
          params.args.data.deletedAt = new Date();
        } else {
          params.args.data = { deletedAt: new Date() };
        }
      }
    }

    return next(params);
  });
}
