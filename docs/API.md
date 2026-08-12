# Kivo API Surface

This document describes the main HTTP routes used by the current Kivo MVP. It is a developer handoff map, not a promise that every route is a permanent public API contract.

## Authentication model

User routes use the `kivo_session` cookie. State-changing authenticated requests also require the user CSRF token in `X-CSRF-Token`.

Owner/admin routes use a separate `kivo_admin` cookie. Owner login is gated by the private Kivo owner configuration before the internal compatibility core is accessed.

## User authentication

### `POST /api/register`

Create a Kivo account.

Body:

```json
{
  "name": "Example User",
  "email": "user@example.com",
  "password": "minimum-eight-characters"
}
```

Returns an authenticated user session and CSRF token.

### `POST /api/login`

Authenticate an existing user.

### `POST /api/logout`

End the current session. Requires CSRF.

### `GET /api/me`

Return current authenticated state and user profile.

## Items / life admin

### `GET /api/items`

Return the authenticated user’s saved Kivo items.

### `POST /api/items`

Create a structured item manually.

Typical fields include:

- `title`
- `category`
- `due_date`
- `due_time`
- `amount`
- `notes`
- `avoidable`
- `recurrence`
- reminder configuration

### `PATCH /api/items/:id/status`

Change item state. Used for complete/paid/cancel/reactivate behavior.

Recurring money items can advance their next due cycle when marked paid.

### `POST /api/items/:id/undo-payment`

Move a recurring item back one cycle when a payment was advanced accidentally.

### `DELETE /api/items/:id`

Remove an owned item.

## Smart capture

### `POST /api/capture`

Accept natural text and/or supported upload content and create a structured Kivo item.

Smart Experience v2 normalizes common text mistakes before forwarding text into the parser.

Example:

```json
{
  "text": "Netflx 9.99 every month on the 11th remind me 1 day before"
}
```

The parser can infer properties such as:

- category
- amount
- date
- recurrence
- reminder timing
- parser confidence

## Reminders

### `GET /api/reminders`

Return reminder candidates relevant to the authenticated user.

The user interface uses these to surface overdue/today/tomorrow/near-term attention states.

## Ask Kivo

### `POST /api/ask`

Ask a grounded question about the authenticated user’s saved Kivo context.

Body:

```json
{
  "q": "wat am i payng for"
}
```

Response includes:

```json
{
  "answer": "...",
  "corrected_query": "...",
  "mode": "local"
}
```

`mode` can be `local` or `cloud` depending on private AI configuration and whether the cloud request succeeds.

### `GET /api/assistant/history`

Return recent Ask Kivo conversation history for the authenticated user.

### `DELETE /api/assistant/history`

Start a fresh Ask Kivo conversation. Requires CSRF.

### `GET /api/smart/status`

Return user-scoped Smart v2 status and counts used by Settings.

## Account & privacy

### `GET /api/account/export`

Download the authenticated user’s Kivo account data in structured JSON form.

The export includes profile/account information and owned product data, but is designed not to expose password hashes or password salts.

### `PATCH /api/account/profile`

Change the current user’s display name. Requires CSRF.

### `POST /api/account/password`

Change password after verifying the current password. Requires CSRF.

On success, other user sessions are closed.

### `DELETE /api/account`

Permanently delete the authenticated account after:

- CSRF validation,
- password verification,
- explicit `DELETE` confirmation.

Owned records and eligible owned uploads are removed from the installation.

## Billing / membership

### `GET /api/billing/status`

Return Free/Pro membership state, usage counters, limits and whether billing is configured.

### `POST /api/billing/checkout`

Create a Stripe Checkout subscription session when Stripe has been privately configured.

### `POST /api/billing/portal`

Create a Stripe Billing Portal session for an account with a Stripe customer record.

### `POST /api/billing/webhook`

Accept signed Stripe webhook events. The signing secret is private server configuration.

Used for subscription state, failed-payment state and recorded revenue events.

## Desktop updates

### `GET /api/update/check`

Check current installed version against the latest Kivo GitHub Release.

Smart v2 uses the robust update engine with multiple release-discovery paths.

### `POST /api/update/install`

Desktop-only self-update endpoint. Requires user authentication and CSRF.

The update engine downloads the Kivo update asset, verifies SHA-256 when a checksum asset is present, and launches the transactional updater.

## Owner/admin

### `POST /api/admin/login`

Authenticate the owner using private `KIVO_ADMIN_EMAIL` / `KIVO_ADMIN_PASSWORD` configuration.

The public owner credential is distinct from the randomized internal core credential.

### `GET /api/admin/me`

Return owner/admin session state.

### `POST /api/admin/logout`

End the owner session.

### `GET /api/admin/stats`

Product/user analytics used by the admin overview.

### `GET /api/admin/billing-stats`

Membership/revenue analytics.

### `GET /api/admin/smart-health`

Smart v2/product-health information.

### `GET /api/admin/security-status`

Return whether private owner configuration is active and whether the compatibility core is isolated on loopback.

## HTTP status expectations

Common patterns:

- `200` successful read/update
- `201` successful creation
- `400` invalid input
- `401` not authenticated / invalid login
- `402` current Free-plan usage limit reached
- `403` CSRF/security confirmation failure
- `404` resource not found/not owned
- `429` should be used for future rate limiting when added
- `500` unexpected server failure
- `502/503` external/update/startup dependency unavailable

## Production API work still worth considering

For a larger public service, consider:

- versioned API namespace,
- formal schema validation,
- rate limiting,
- structured request IDs,
- formal OpenAPI document,
- pagination for large datasets,
- managed session store,
- email verification/password recovery,
- standardized error codes in addition to human-readable error text.
