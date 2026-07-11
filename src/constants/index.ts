export const APP_NAME = "ResumeRank AI";
export const APP_DESCRIPTION =
  "AI-powered resume analysis, ATS scoring, and career optimization platform.";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// File upload limits
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ACCEPTED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
} as const;
export const ACCEPTED_MIME_TYPES = Object.keys(ACCEPTED_FILE_TYPES);

// Subscription limits
export const PLAN_LIMITS = {
  FREE: {
    analysesPerMonth: 3,
    resumesMax: 3,
    historyDays: 30,
  },
  PRO: {
    analysesPerMonth: 999999,
    resumesMax: 999999,
    historyDays: 365,
  },
  TEAM: {
    analysesPerMonth: 999999,
    resumesMax: 999999,
    historyDays: 365,
    seats: 5,
  },
} as const;

// Rate limiting
export const RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 100,
  AI_REQUESTS_PER_MINUTE: 10,
  UPLOAD_REQUESTS_PER_MINUTE: 20,
} as const;

// Pagination
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

// ATS score thresholds
export const ATS_SCORE_THRESHOLDS = {
  EXCELLENT: 85,
  GOOD: 70,
  AVERAGE: 55,
  POOR: 0,
} as const;

// Navigation
export const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/resumes", label: "Resumes", icon: "FileText" },
  { href: "/analyze", label: "Analyze", icon: "Sparkles" },
  { href: "/history", label: "History", icon: "History" },
  { href: "/billing", label: "Billing", icon: "CreditCard" },
] as const;

export const ADMIN_NAV_LINKS = [
  { href: "/admin", label: "Overview", icon: "LayoutDashboard" },
  { href: "/admin/users", label: "Users", icon: "Users" },
  { href: "/admin/analytics", label: "Analytics", icon: "BarChart3" },
  { href: "/admin/feature-flags", label: "Feature Flags", icon: "Flag" },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: "Shield" },
] as const;

// API routes
export const API_ROUTES = {
  AUTH: "/api/v1/auth",
  RESUMES: "/api/v1/resumes",
  JOB_DESCRIPTIONS: "/api/v1/job-descriptions",
  ANALYSES: "/api/v1/analyses",
  DASHBOARD: "/api/v1/dashboard",
  NOTIFICATIONS: "/api/v1/notifications",
  BILLING: "/api/v1/billing",
  ADMIN: "/api/v1/admin",
} as const;

// Storage
export const STORAGE_PATHS = {
  RESUMES: "resumes",
  AVATARS: "avatars",
} as const;
