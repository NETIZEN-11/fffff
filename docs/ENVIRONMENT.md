# Environment Variables

Copy `.env.example` to `.env.local`. Never commit `.env.local`.

**Note:** All environment variables are validated at application startup using Zod. If any required variables are missing or invalid, the application will fail to start with detailed error messages.

## Required Variables

### App
| Variable                    | Description                    |
|-----------------------------|--------------------------------|
| `NEXT_PUBLIC_APP_URL`       | Your app URL (no trailing /)   |
| `AUTH_SECRET`               | Random 32+ char secret         |

### Database (Supabase)
| Variable      | Description                     |
|---------------|---------------------------------|
| `DATABASE_URL` | PostgreSQL connection string    |
| `DIRECT_URL`   | Direct (non-pooled) connection  |

### OAuth
| Variable               | Where to get                         |
|------------------------|--------------------------------------|
| `AUTH_GOOGLE_ID`       | console.cloud.google.com             |
| `AUTH_GOOGLE_SECRET`   | console.cloud.google.com             |
| `AUTH_GITHUB_ID`       | github.com/settings/applications     |
| `AUTH_GITHUB_SECRET`   | github.com/settings/applications     |

### Supabase Storage
| Variable                         | Description              |
|----------------------------------|--------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`       | Project URL              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Public anon key          |
| `SUPABASE_SERVICE_ROLE_KEY`      | Service role key (secret)|
| `SUPABASE_STORAGE_BUCKET`        | Bucket name (e.g. resumes)|

### OpenAI
| Variable              | Description                 |
|-----------------------|-----------------------------|
| `OPENAI_API_KEY`      | sk-... API key              |
| `OPENAI_MODEL`        | Default: gpt-4o-mini        |
| `OPENAI_REWRITE_MODEL`| Default: gpt-4o             |

### Stripe
| Variable                         | Description                |
|----------------------------------|----------------------------|
| `STRIPE_SECRET_KEY`              | sk_test_... or sk_live_... |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | pk_test_...            |
| `STRIPE_WEBHOOK_SECRET`          | whsec_...                  |
| `STRIPE_PRO_PRICE_ID`            | price_... for Pro plan     |
| `STRIPE_TEAM_PRICE_ID`           | price_... for Team plan    |

### Webhooks
| Variable                | Description                                      |
|-------------------------|--------------------------------------------------|
| `WEBHOOK_RETRY_SECRET`  | Secret for webhook retry endpoint (min 32 chars) |

### Resend
| Variable          | Description                |
|-------------------|----------------------------|
| `RESEND_API_KEY`  | re_...                     |
| `RESEND_FROM_EMAIL` | noreply@yourdomain.com   |

### Inngest
| Variable              | Description               |
|-----------------------|---------------------------|
| `INNGEST_EVENT_KEY`   | From Inngest dashboard    |
| `INNGEST_SIGNING_KEY` | From Inngest dashboard    |

## Generating AUTH_SECRET

```bash
openssl rand -base64 32
```

## Generating IMPERSONATION_SECRET

```bash
openssl rand -base64 32
```

## Generating WEBHOOK_RETRY_SECRET

```bash
openssl rand -base64 32
```

## Validation

Environment variables are automatically validated when the application starts. If validation fails:
1. Check the error messages in the console
2. Compare your `.env.local` with `.env.example`
3. Ensure all required variables are set with correct formats
4. Required formats:
   - OpenAI keys must start with `sk-`
   - Stripe publishable keys must start with `pk_`
   - Stripe secret keys must start with `sk_`
   - Stripe webhook secrets must start with `whsec_`
   - Stripe price IDs must start with `price_`
   - Resend API keys must start with `re_`
   - Inngest signing keys must start with `signkey-`

## Webhook Retry System

The webhook retry system requires a secret token to authenticate scheduled retry processing:

1. Set `WEBHOOK_RETRY_SECRET` to a secure random string (min 32 chars)
2. Call the retry endpoint via cron job:
   ```bash
   curl -X POST https://your-domain.com/api/v1/webhooks/retry \
     -H "Authorization: Bearer your-webhook-retry-secret"
   ```
3. Recommended schedule: Every 5 minutes
4. Failed webhooks are retried up to 3 times with exponential backoff (1min, 5min, 15min)
