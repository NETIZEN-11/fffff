# Architecture

## Overview

ResumeRank AI follows a **Feature-First, Clean Architecture** pattern with clear separation of concerns across domain boundaries.

## Bounded Contexts

```
┌─────────────────────────────────────────────────────────┐
│                    ResumeRank AI                         │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Identity │  │  Resume  │  │      Analysis        │  │
│  │ auth     │  │ upload   │  │  AI pipeline         │  │
│  │ RBAC     │  │ storage  │  │  ATS scoring         │  │
│  │ sessions │  │ versioning│  │  skill extraction    │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Billing  │  │  Admin   │  │      Workspace       │  │
│  │ Stripe   │  │ platform │  │  team collaboration  │  │
│  │ plans    │  │ analytics│  │  shared analyses     │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Request Flow

```
Browser → Next.js Middleware (auth + rate limit check)
       → App Router (SSR or client component)
       → API Route Handler
       → Service Layer (business logic)
       → Repository Layer (data access)
       → Prisma ORM → PostgreSQL
```

## AI Pipeline (Background)

```
POST /api/v1/analyses
  → Create PENDING record in DB
  → Inngest.send("analysis/requested")
  → Return 202 to client

Inngest Worker:
  → Fetch resume URL from Supabase Storage
  → Extract text (pdf-parse / mammoth)
  → Sanitize for prompt injection
  → POST to OpenAI GPT-4o-mini
  → Parse + validate JSON response
  → Store all results in DB (transaction)
  → Create notification
  → Send email via Resend
  → Update status to COMPLETED
```

## Layer Responsibilities

| Layer       | Responsibility                          | Location             |
|-------------|----------------------------------------|----------------------|
| Route Handler | HTTP parsing, auth check, response format | `app/api/v1/**`     |
| Service     | Business logic, orchestration           | `modules/*/services` |
| Repository  | Database queries, data access           | `modules/*/repositories` |
| Schema      | Input validation (Zod)                  | `modules/*/schemas`  |
| Component   | UI rendering, no business logic         | `modules/*/components` |

## Security Architecture

- All routes protected by Auth.js middleware
- RBAC enforced at API route level
- Prompt injection sanitization before every OpenAI call
- File validation: MIME type + size checked server-side
- Audit log on all CREATE/UPDATE/DELETE/ADMIN actions
- Rate limiting: 100 req/min global, 10 AI req/min per user
- CSP headers set in `next.config.ts`
- httpOnly, Secure, SameSite cookies via Auth.js

## Scalability Decisions

- **Stateless API** — no server-side state, safe to horizontal scale
- **Background jobs via Inngest** — AI calls never block HTTP responses
- **Supabase Storage** — files never stored in database
- **PostgreSQL indexes** on all foreign keys and query-hot columns
- **Server Components** for data-fetching pages (no client waterfall)
- **TanStack Query** client-side cache reduces redundant API calls
