# Kivo — Life, handled.

Kivo is a mobile-first personal life-admin product for recurring bills, subscriptions, deadlines, reminders, everyday tasks and searchable personal context.

This repository contains the working browser/desktop MVP, the Smart v2 assistant layer, owner analytics, optional Stripe billing, PWA support, Docker deployment, automatic GitHub releases and the buyer/developer handoff documentation.

> **Current product stage:** working commercial MVP / acquisition-ready software project. Kivo is not represented here as an already-published native iOS or Android app.

## What Kivo does

- **Universal Inbox** — capture natural text such as `Netflix 9.99 every 11th remind me a day before` and turn it into structured life admin.
- **Smart reminders** — surface overdue, today, tomorrow and near-term items instead of showing one giant undifferentiated list.
- **Kivo Money** — track recurring charges, renewals, optional spending and payment cycles.
- **Ask Kivo Smart v2** — ask natural questions about saved information, including casual wording, common typos and follow-up questions.
- **Recurring payment controls** — mark a cycle paid, undo a cycle, cancel/reactivate or remove an item.
- **Owner analytics** — users, activity, memberships, revenue metrics and product health.
- **Free / Pro membership architecture** — optional Stripe Checkout + Billing Portal integration.
- **Installable web app** — PWA-ready browser experience with private API responses excluded from caching.
- **Automatic desktop updates** — GitHub Releases + transactional local updater with validation and rollback.

## Fastest way to run it on Windows

1. Install **Node.js 22+**.
2. Download the latest **Kivo update package** from GitHub Releases.
3. Extract it into a permanent Kivo folder.
4. Run `start-kivo.bat`.
5. On the first local launch, Kivo creates private owner credentials locally.
6. Run `show-owner-login.bat` if you need to view the generated local owner login.

Kivo opens at `http://localhost:8488/app`.

## Deployment

A Docker deployment is included and runs the same **Smart Experience v2** stack as the Windows demo.

Copy `.env.example` to a private `.env`, set at minimum a strong `KIVO_ADMIN_PASSWORD`, then use Docker Compose.

See [Deployment](docs/DEPLOYMENT.md) for the full setup and production checklist.

## Intelligence modes

Kivo works without a cloud AI key using **Smart Local v2**, which provides contextual prioritisation, fuzzy item matching, typo correction, recurring-money reasoning and follow-up handling.

For a more general language-model experience, configure `OPENAI_API_KEY` privately. Kivo then uses cloud reasoning with Smart Local v2 as the fallback. API secrets are not intended to be committed to this repository.

## Release quality gates

Every code release must pass:

1. JavaScript syntax validation.
2. Static product/security smoke checks.
3. A real end-to-end boot test on a fresh temporary database.
4. User registration and authenticated session validation.
5. Messy recurring-subscription capture parsing.
6. Ask Kivo typo/context and follow-up checks.
7. Private owner-login/security checks.
8. PWA privacy checks.
9. Release packaging validation.

Only then does GitHub create the versioned `Kivo-update.zip` release.

## Automatic updates

Desktop Kivo uses a multi-path GitHub update engine. It checks published Releases, validates the downloaded package, creates a rollback copy, protects runtime/private folders, syntax-checks the candidate build and restores the previous application files if installation fails.

The updater does not intentionally replace:

- `data/`
- `uploads/`
- `updates/`
- `backups/`
- `.env`
- `business-config.bat`

## Private configuration

Never commit real secrets or user runtime data.

Ignored/private examples include:

- `business-config.bat`
- `.env`
- `owner-login.txt`
- `data/`
- `uploads/`
- database files
- Stripe keys
- AI API keys

Use `business-config.example.bat` for Windows configuration and `.env.example` for server/Docker configuration.

## Handoff documentation

- [Product handoff](docs/PRODUCT_HANDOFF.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Commercial readiness checklist](docs/COMMERCIAL_READINESS.md)

## Repository structure

```text
Kivo
├── smart-experience-v2.js    # Official Smart v2 app gateway
├── lib/update-engine.js      # GitHub release/update engine
├── bootstrap.js              # Membership, billing and secure owner gateway
├── core-runtime.js           # Isolated legacy-core runtime adapter
├── force-loopback.js         # Prevents direct LAN exposure of core process
├── server.js                 # Core data/auth/capture/reminder engine
├── public/                   # Web/mobile-first UI and PWA files
├── scripts/                  # Release and end-to-end tests
├── docs/                     # Buyer/developer handoff documentation
└── .github/workflows/        # Tested automatic release pipeline
```

## Commercial note

A buyer should perform their own legal, security, privacy, payment and app-store review before a public commercial launch. The repository is structured to make that review and handoff substantially easier; it is not a substitute for professional legal or security certification.
