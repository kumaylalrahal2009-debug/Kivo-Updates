# Kivo Architecture

## Design goal

Kivo is structured as layered services so newer commercial features can be added around the original working core without repeatedly rewriting the entire application.

The official runtime path is:

```text
Browser / PWA
    │
    ▼
smart-experience-v2.js
    │  Smart assistant, history, update engine, smart-health API
    ▼
experience.js
    │  application experience / membership-limit gateway
    ▼
bootstrap.js
    │  billing, private owner gate, membership/revenue layer
    ▼
core-runtime.js + force-loopback.js
    │  isolated compatibility adapter
    ▼
server.js
       auth, users, sessions, items, reminders, parser, admin stats
```

The browser receives the original frontend plus additive product layers:

```text
/styles.css
  = public/styles.css
  + public/premium.css
  + public/smart-ui.css

/app.js
  = public/app.js
  + public/premium.js
  + public/smart-client.js
```

## Smart Experience v2

`smart-experience-v2.js` is the official outer application process.

Responsibilities:

- Smart Local v2 assistant reasoning
- optional cloud AI gateway
- common typo correction
- fuzzy matching against saved items
- conversation history
- follow-up resolution
- smart-status API
- admin smart-health API
- robust GitHub update API
- frontend Smart JS/CSS composition

It starts the inner experience on loopback ports and exposes the user-facing application port.

## Core isolation

`server.js` is the legacy working data/auth/parser core.

The official product does not execute it directly.

`core-runtime.js` loads the core source and replaces the old prototype admin constants in memory using randomized internal credentials provided by `bootstrap.js`.

`force-loopback.js` ensures that legacy core process listens only on `127.0.0.1`.

The public owner credential is therefore handled by the outer private configuration layer, not by the prototype credential embedded in the historical core source.

## Data model

Primary runtime database:

`data/kivo.db` locally, or the configured `KIVO_DATA_DIR` path.

Important tables include:

- `users`
- `sessions`
- `items`
- `item_due_history`
- `admin_sessions`
- `analytics_events`
- `memberships`
- `billing_events`
- `assistant_messages`

### Items

An item can contain:

- title
- category
- due date/time
- amount
- notes
- status
- recurrence
- reminder timing
- avoidable-spend flag
- uploaded-file reference
- parser confidence

## Smart assistant

### Smart Local v2

Works without a cloud AI account.

Uses:

- deterministic intent rules
- saved-item snapshot
- relative-date calculations
- fuzzy title/note matching
- typo normalization
- recent assistant history
- priority ordering
- recurring-spend calculations

### Optional cloud mode

When `OPENAI_API_KEY` is configured privately, Smart v2 can send a grounded snapshot to the configured language model.

The prompt instructs the model to use supplied Kivo data for claims about the user’s life and to avoid inventing dates, amounts, subscriptions or tasks.

If the cloud request fails or exceeds the configured timeout, Kivo falls back to Smart Local v2.

## Updates

`lib/update-engine.js` performs release discovery and update download.

It uses more than one GitHub Releases discovery path and returns detailed failure state to the UI.

`apply-update.ps1` performs the installation:

1. wait for running Kivo process to exit,
2. create rollback snapshot,
3. extract update to temporary directory,
4. verify required files,
5. syntax-check candidate JavaScript,
6. copy only application files,
7. verify installed files,
8. restart Kivo,
9. restore previous application files if installation fails.

## PWA

`public/manifest.json` defines the installable app metadata.

`public/sw.js` deliberately does **not** cache:

- `/api/*`
- `/app.js`
- `/styles.css`

This prevents private account/API responses from being put into the PWA shell cache and avoids hiding freshly installed Kivo software updates behind stale JS/CSS.

## Billing

`bootstrap.js` owns membership/payment integration.

Current architecture supports:

- Free / Pro account state
- Stripe Checkout session creation
- Stripe Billing Portal session creation
- webhook validation
- subscription-state updates
- recorded billing events
- MRR/revenue estimates for owner analytics

Without private Stripe configuration, Kivo remains in billing setup/demo mode.

## Testing

### Static release smoke test

`scripts/release-smoke.js`

Checks critical architecture, security assumptions, PWA safety, updater behavior, required files and frontend features.

### End-to-end product smoke test

`scripts/integration-smoke.js`

Boots the actual Smart v2 stack against a clean temporary database and performs real HTTP requests through the full layered application.

The GitHub release workflow will not publish an application release if these tests fail.
