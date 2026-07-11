# Environment Variables

Copy `.env.example` to `.env.local`. Never commit `.env.local`.

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
