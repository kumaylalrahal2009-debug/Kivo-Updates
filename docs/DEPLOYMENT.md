# Kivo Deployment

Kivo supports two main deployment modes: a local Windows product demo and a Docker/server deployment.

## 1. Windows local demo

### Requirements

- Windows 10/11
- Node.js 22+
- a modern browser

### Start

Run:

```text
start-kivo.bat
```

The launcher:

1. verifies Node.js,
2. creates local runtime folders,
3. creates private owner credentials on first run if needed,
4. loads private configuration,
5. avoids launching duplicate Kivo service stacks,
6. starts Smart Experience v2,
7. waits for Kivo to become healthy,
8. opens the app in the browser.

Default app URL:

```text
http://localhost:8488/app
```

### Owner login

On a new local installation, `ensure-local-config.ps1` creates:

- `business-config.bat` — private local configuration
- `owner-login.txt` — local one-time-readable owner credential helper

Use:

```text
show-owner-login.bat
```

Do not upload either private credential file to GitHub.

## 2. Docker deployment

### Requirements

- Docker / Docker Compose
- private `.env`
- production domain/reverse proxy for a public deployment

Copy:

```text
.env.example
```

to:

```text
.env
```

At minimum, change:

```text
KIVO_ADMIN_PASSWORD
```

For a real public deployment also configure:

```text
KIVO_PUBLIC_URL=https://your-domain.example
SECURE_COOKIES=true
```

Then:

```bash
docker compose up -d --build
```

The default Compose mapping exposes Kivo on port `8080`.

## Reverse proxy / HTTPS

For an internet-facing deployment, place Kivo behind a production reverse proxy or managed platform that terminates HTTPS.

Recommended properties:

- HTTPS only
- redirect HTTP → HTTPS
- set `SECURE_COOKIES=true`
- reasonable request/body limits
- security headers
- access/error logs
- trusted backup storage

## Persistent data

Docker uses the `kivo-data` volume mounted at `/data`.

Important runtime content includes:

- SQLite database
- uploaded user content

Do not treat the application image/container filesystem as your only copy of production data.

## AI configuration

Smart Local v2 works without cloud AI.

Optional variables:

```text
OPENAI_API_KEY=
KIVO_AI_MODEL=gpt-5-mini
KIVO_AI_TIMEOUT_MS=8500
```

Keep API keys server-side. Never expose them to frontend JavaScript.

## Stripe configuration

Optional variables:

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
KIVO_PRO_MONTHLY_AUD=7.99
KIVO_PRO_YEARLY_AUD=59.99
```

A real Stripe deployment also needs its webhook endpoint configured to send relevant billing events to:

```text
/api/billing/webhook
```

Do not accept real customer payments until webhook delivery and subscription-state handling have been tested in the chosen Stripe account/environment.

## Desktop self-updates vs server deployment

Desktop Kivo can self-update because `KIVO_LOCAL_DESKTOP=true` is set by the Windows launcher.

Docker/server deployment sets it to false. Server deployments should normally be updated through their deployment pipeline/image replacement rather than by a Windows PowerShell self-updater.

## Health checks

Docker checks:

```text
/api/admin/me
```

The application also exposes authenticated Smart/product health information to the owner dashboard.

## Production-readiness checklist

Before putting a deployment on the public internet:

- [ ] private owner password configured
- [ ] HTTPS enabled
- [ ] secure cookies enabled
- [ ] `.env` excluded from source control
- [ ] backup and restore process tested
- [ ] account deletion/privacy workflow reviewed
- [ ] real support/contact channel configured
- [ ] payment/webhook integration tested if enabled
- [ ] legal/privacy/consumer requirements reviewed
- [ ] rate limiting / abuse controls added for public scale
- [ ] logs and monitoring configured
- [ ] staging environment tested before production changes
