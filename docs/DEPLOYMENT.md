# Deployment Guide

## Prerequisites

- Vercel account
- Supabase project (PostgreSQL + Storage)
- Stripe account with products created
- Resend account
- Inngest account
- OpenAI API key

## Step 1 — Supabase Setup

1. Create a new Supabase project
2. Copy `DATABASE_URL` and `DIRECT_URL` from Settings → Database
3. Create a Storage bucket named `resumes` with public access
4. Copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## Step 2 — Stripe Setup

1. Create two products in Stripe Dashboard:
   - **Pro** — $19/month recurring → copy Price ID
   - **Team** — $49/month recurring → copy Price ID
2. Set `STRIPE_PRO_PRICE_ID` and `STRIPE_TEAM_PRICE_ID`
3. Add webhook endpoint: `https://your-app.vercel.app/api/v1/billing/webhook`
4. Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

## Step 3 — Run Migrations

```bash
# Using local connection to production DB:
DATABASE_URL="postgresql://..." npm run db:migrate:prod
npm run db:seed
```

## Step 4 — Deploy to Vercel

```bash
npx vercel --prod
```

Or connect GitHub repo in Vercel dashboard.

### Set Environment Variables in Vercel

Add all variables from `.env.example` in:
Vercel Dashboard → Project → Settings → Environment Variables

## Step 5 — Inngest

1. Deploy to production first
2. In Inngest dashboard, add app URL: `https://your-app.vercel.app/api/inngest`
3. Copy `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` into Vercel env vars
4. Redeploy

## Step 6 — OAuth Setup

### Google
1. Go to console.cloud.google.com → Credentials
2. Create OAuth 2.0 Client ID
3. Add `https://your-app.vercel.app/api/auth/callback/google` to authorized redirect URIs

### GitHub
1. Go to github.com/settings/applications → New OAuth App
2. Set Homepage URL and Authorization callback URL to `https://your-app.vercel.app/api/auth/callback/github`

## Verify

- [ ] `https://your-app.vercel.app/api/health` returns `{"status":"healthy"}`
- [ ] Sign up with email works
- [ ] Google/GitHub OAuth works
- [ ] Resume upload stores file in Supabase Storage
- [ ] Analysis job runs in Inngest
- [ ] Stripe checkout completes
- [ ] Stripe webhook receives events
