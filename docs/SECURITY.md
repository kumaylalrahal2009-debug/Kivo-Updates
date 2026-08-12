# Kivo Security Model

This document describes the security controls currently present in Kivo and the areas that should receive further review before a large public deployment.

## Principles

Kivo currently aims to:

- keep secrets out of public source control,
- isolate account data by authenticated user,
- keep the legacy core off the LAN/public network,
- gate owner access with private configuration,
- protect state-changing user requests with CSRF tokens,
- hash user passwords,
- validate Stripe webhooks,
- avoid caching private API data in the PWA,
- validate software releases before installing them,
- roll back failed desktop updates.

## User authentication

User passwords are salted and hashed in the core database rather than stored as plain text.

User sessions use opaque tokens. The application stores a hash of the session token server-side.

State-changing user API requests require the authenticated session plus the expected CSRF token.

## Owner/admin authentication

The original prototype core contained a starter admin credential. The official runtime path does not rely on that credential.

Current official path:

1. `bootstrap.js` reads the private owner credential from `KIVO_ADMIN_EMAIL` / `KIVO_ADMIN_PASSWORD`.
2. A random internal core-admin password is created per Kivo process.
3. `core-runtime.js` replaces the prototype admin constants in memory with that internal credential.
4. `force-loopback.js` restricts the legacy core server to `127.0.0.1`.
5. Public owner login is checked by the outer bootstrap layer before internal authentication is performed.

For Windows demo installs, owner credentials can be generated locally on first launch.

For server deployments, `KIVO_ADMIN_PASSWORD` must be configured privately.

## Network boundaries

Only the outer Kivo service should be intentionally exposed.

The compatibility core is bound to loopback and should not be directly reachable from another device on the network.

Docker exposes only the outer Kivo port.

## Private configuration

Never commit:

- `business-config.bat`
- `.env`
- `owner-login.txt`
- API keys
- Stripe secret keys
- webhook signing secrets
- production database files
- private user uploads

These are excluded through `.gitignore` and release smoke checks where applicable.

## PWA/cache privacy

The service worker explicitly does not cache `/api/*` requests.

The main generated app JS/CSS responses are also kept out of the PWA shell cache so a software update is not hidden by an old cached bundle.

## Stripe

Stripe webhook payloads are checked against the configured webhook signing secret before billing events are accepted.

Private Stripe secret keys are used server-side only.

## Cloud AI

If enabled, the AI API key is loaded from server/private configuration and is never intended to be embedded in frontend JavaScript.

Kivo sends a bounded structured snapshot of relevant saved data and recent conversation context to the configured model for grounded responses.

The cloud call uses a timeout and falls back to Smart Local v2.

Organizations deploying Kivo should review the privacy/data-processing terms of any external AI provider they choose to configure.

## Updates

Desktop update installation is transactional:

- candidate package validation
- required-file verification
- JavaScript syntax checks
- application rollback snapshot
- runtime/private folder protection
- post-copy verification
- rollback if installation throws

The release itself must also pass GitHub static and end-to-end product tests before publication.

## Known areas for further production hardening

Before high-volume public use, consider adding or independently reviewing:

- rate limiting / brute-force protection
- email verification
- password-reset flow
- optional MFA for owner/admin
- formal Content Security Policy review
- dependency and container vulnerability scanning
- structured security logging
- production secrets manager
- managed database / encryption-at-rest strategy
- account deletion and retention controls
- upload malware/content scanning if broad file uploads are enabled
- penetration testing
- backup restore drills
- incident-response process

## Reporting a security issue

For a commercial release, replace this section with a real private security contact process rather than asking reporters to post sensitive vulnerabilities publicly in GitHub Issues.
