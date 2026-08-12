# Kivo Data Model

Kivo currently uses SQLite for the working MVP. The database is intentionally simple enough for a local/demo deployment while preserving a migration path to a managed SQL database later.

## Ownership rule

User-owned records are keyed by `user_id` and should only be returned or mutated through an authenticated session for that same user.

The owner/admin analytics layer is separate from normal user access.

## Main tables

### `users`

Represents a Kivo account.

Important fields:

- `id`
- `name`
- `email`
- `password_hash`
- `password_salt`
- `created_at`
- `last_seen_at`

Password hashes/salts are never intended to be exposed to frontend account exports.

### `sessions`

Authenticated user sessions.

Important fields:

- hashed session token
- `user_id`
- CSRF token
- expiry
- created time

Kivo sends the opaque session token in an HTTP-only cookie and stores only its hash server-side.

### `items`

The main life-admin object.

Typical fields:

- `id`
- `user_id`
- `title`
- `category`
- `due_date`
- `due_time`
- `amount`
- `notes`
- `status`
- `avoidable`
- `file_name`
- `file_path`
- `created_at`
- `recurrence`
- `recurrence_interval`
- `recurrence_day`
- `recurrence_weekday`
- `reminder_days`
- `parser_confidence`
- `parsed_at`

Current categories include concepts such as:

- task
- deadline
- event
- money
- document

### `item_due_history`

Tracks recurring due-date movement so advancing a paid recurring charge can be undone safely.

Used by the “Back 1 cycle” behavior.

### `analytics_events`

Product-use events such as capture and Ask Kivo activity.

Used for owner/admin analytics and Free-plan usage counters.

### `assistant_messages`

Recent Ask Kivo conversation context.

Fields include:

- user ID
- role
- content
- created time

Smart v2 intentionally keeps a bounded recent history rather than allowing the table to grow without limit for every conversational turn.

### `memberships`

Free / Pro commercial state.

Important fields:

- `user_id`
- plan
- status
- billing interval
- Stripe customer ID
- Stripe subscription ID
- current period end
- created/updated timestamps

Private payment credentials are not stored in this table.

### `billing_events`

Normalized payment/subscription events recorded by the Kivo billing layer.

Used for owner revenue analytics.

Important fields:

- user ID
- provider event ID
- event type
- AUD amount recorded
- created time

### `admin_sessions`

Owner/admin session state, separate from normal user sessions.

## Runtime file storage

Uploads are stored under the configured uploads directory and referenced by owned item records.

Account deletion attempts to remove item-owned uploaded files only when their resolved path is inside the configured Kivo uploads root.

## Data export

The account export is designed to include user-owned product data such as:

- profile
- items
- assistant history
- membership state
- normalized billing-event history

It should not include:

- password hashes
- password salts
- private server secrets
- another user’s data
- raw private business configuration

## Deletion

Permanent account deletion is intended to remove:

- assistant messages
- billing events associated with the user
- membership record
- analytics events
- due-history records
- owned items
- owned sessions
- user row
- eligible owned upload files

A production privacy review should decide what accounting/legal records, if any, must be retained separately from ordinary account data in the intended market.

## Migration path

If Kivo scales beyond a single-instance SQLite deployment, a practical migration target is a managed relational database such as PostgreSQL.

The current schema maps naturally to relational tables. A larger service would additionally benefit from:

- database migrations/versioning,
- connection pooling,
- background jobs,
- immutable billing audit records,
- retention policies,
- encrypted backups,
- staging/production separation,
- formal restore procedures.
