# Changelog

All notable changes to ResumeRank AI are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — 2024-01-15

### Added
- Full authentication system (email/password, Google OAuth, GitHub OAuth)
- Resume upload with PDF and DOCX support via Supabase Storage
- Resume versioning and soft delete
- Job description creation and storage
- AI analysis pipeline powered by OpenAI GPT-4o-mini
- ATS score with detailed breakdown (keyword, formatting, sections, readability, experience)
- Skill gap detection (critical, important, nice-to-have)
- AI resume rewrite suggestions
- AI interview questions (behavioral, technical, situational)
- Career path recommendations
- Analysis history with search, filter, pagination
- Dashboard with score trend charts and top missing skills
- CSV export for analytics
- Subscription plans (Free / Pro $19 / Team $49) via Stripe
- Stripe webhook handling with idempotent payment processing
- In-app notification center
- Email notifications via Resend
- Admin dashboard with user management
- Admin feature flags management
- Audit logging for all platform actions
- Dark mode support
- Responsive, accessible UI (WCAG 2.1 AA)
- Background job processing via Inngest
- Rate limiting on all API endpoints
- Prompt injection protection
- Full test suite (Vitest unit + Playwright E2E)

---

## [Unreleased]

### Planned
- OCR support for scanned PDFs
- LinkedIn profile import
- Resume comparison tool (side-by-side)
- Team workspace with shared analyses
- Weekly summary emails
- Two-factor authentication (TOTP)
- Real-time analysis status via Server-Sent Events
- Resume builder (from scratch)
- API keys for programmatic access
