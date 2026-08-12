# Kivo Product Handoff

This document is the high-level handoff guide for a buyer, developer or technical due-diligence reviewer taking over Kivo.

## What is being handed over

Kivo is a working mobile-first web/desktop MVP with:

- user registration and login,
- account-isolated SQLite data,
- natural-text capture and structured item parsing,
- recurring payments/subscriptions,
- reminders and deadlines,
- Kivo Money,
- Ask Kivo Smart v2,
- optional cloud AI connection,
- Free / Pro membership logic,
- optional Stripe Checkout and Billing Portal architecture,
- owner/admin analytics,
- product-health analytics,
- PWA/installable web-app support,
- Windows local-demo launcher,
- Docker deployment,
- automatic GitHub Releases,
- transactional desktop updates with rollback,
- static and end-to-end release testing.

## What it is not

The current repository is not claiming to be:

- an already-published Apple App Store application,
- an already-published Google Play application,
- a completed legal/privacy certification,
- a payment processor itself,
- a bank connection/open-banking product,
- a finished enterprise-scale infrastructure deployment.

A buyer can preserve the browser/PWA experience, wrap it, or rebuild the frontend in React Native, Flutter or native iOS/Android while retaining useful backend/product logic.

## Product surfaces

### Public website

Marketing, pricing, login and registration entry points.

### User app

- Home / priority view
- Universal Inbox
- Kivo Money
- Ask Kivo
- Settings / membership / update status / install controls

### Owner/admin

- user growth
- activity
- memberships
- revenue metrics
- Smart-engine health
- deployed-version health

## Core commercial configuration

Private configuration is deliberately separated from public code.

### Windows/local demo

Copy/use `business-config.bat` privately. First local launch can generate owner credentials automatically.

### Server/Docker

Copy `.env.example` to `.env` and configure private values.

Important variables:

- `KIVO_ADMIN_EMAIL`
- `KIVO_ADMIN_PASSWORD`
- `KIVO_PUBLIC_URL`
- `OPENAI_API_KEY` (optional)
- `KIVO_AI_MODEL` (optional)
- Stripe keys/price IDs (optional until payments are activated)

## Source ownership / due diligence

Before acquisition or public commercial launch, a buyer should review:

1. Git history and contributor history.
2. Third-party dependencies and licences.
3. Brand/trade-mark availability.
4. Privacy-policy requirements for intended markets.
5. Consumer-law/subscription requirements.
6. Payment-provider requirements.
7. Security model and penetration testing.
8. Native app-store requirements if converting to iOS/Android.

Kivo currently has a deliberately small dependency footprint: the app primarily uses built-in Node.js APIs and browser APIs rather than a large package tree.

## Recommended acquisition package

A sale/transfer should normally include, as agreed in writing:

- GitHub repository ownership/access,
- source code,
- release history,
- brand assets that are actually owned by the seller,
- domain names included in the transaction,
- product documentation,
- private infrastructure configuration transferred through a secure method,
- payment-provider ownership/configuration if included,
- deployment credentials if included,
- explicit IP assignment/sale agreement.

Do not transfer a personal GitHub password or personal payment-account password. Transfer repository/business resources using the platform’s ownership/team mechanisms.

## Suggested next technical milestones after acquisition

### Near term

- production domain + HTTPS
- managed database choice if scaling beyond a single server
- email verification/password recovery
- production observability/error reporting
- privacy/account deletion workflow
- real Stripe business connection
- legal policy review

### Mobile conversion

- choose native/React Native/Flutter/Capacitor strategy
- map PWA screens to mobile navigation
- use native push notifications
- use secure device credential storage
- implement store-compliant subscriptions if required by the chosen store/product model

### Scale

- move sessions/data to managed infrastructure
- background jobs/reminder delivery
- rate limiting and abuse protection
- structured application logs
- automated backups and restore drills
- staging/production environments

## Current quality bar

Code releases are automatically syntax-checked, statically smoke-tested and booted end-to-end on a fresh temporary database before GitHub publishes a release package.

That release gate tests the actual product flow, including user registration, natural-text capture, Ask Kivo context, owner security and PWA privacy behavior.
