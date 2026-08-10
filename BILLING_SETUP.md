# Kivo Pro billing setup

Kivo now has one simple paid membership:

- **Kivo Free — A$0**
  - 30 smart captures each month
  - 15 Ask Kivo messages each day
  - recurring subscriptions and reminders
  - core Kivo Money
- **Kivo Pro — A$7.99/month**
  - unlimited smart captures
  - unlimited Ask Kivo
  - premium automation and future integrations
- Optional yearly Pro pricing is prepared at **A$59.99/year**.

## How payments work

Kivo uses Stripe Checkout for subscription signup and Stripe's customer portal for users to manage billing. The app does not store card numbers itself.

The admin dashboard adds:

- estimated MRR
- total successful revenue recorded
- revenue from the last 30 days
- active Pro members
- free members
- free-to-Pro conversion rate
- Stripe connection status

Successful `invoice.paid` webhook events are used for collected-revenue totals.

## Connect a business Stripe account

1. Create the Kivo Pro product/prices in the Stripe Dashboard.
2. Copy `business-config.example.bat` to `business-config.bat`.
3. Fill in the secret key, webhook secret and Price IDs.
4. Keep `business-config.bat` private. It is intentionally ignored by Git and protected by the updater.
5. Configure the Stripe webhook endpoint as:
   `https://YOUR-DOMAIN/api/billing/webhook`
6. Enable Stripe's customer portal so Pro members can manage/cancel their subscription.
7. Set `KIVO_PUBLIC_URL` to the real HTTPS website before taking live payments.

For local development, use Stripe test-mode values only.

## Persistence and updates

User accounts and Kivo data live in the `data/` directory. Uploads live in `uploads/`.

The launcher always points Kivo to those same directories. The GitHub updater explicitly protects:

- `data/`
- `uploads/`
- `updates/`
- `backups/`
- `.env`
- `business-config.bat`

Before applying an update, Kivo also makes a database backup. This means application-code updates should not require users to create a new account again.

## Before public commercial launch

Use HTTPS, a production database/storage setup, secure production Stripe keys, a reviewed privacy policy/terms, reliable email/password recovery, and proper operational monitoring. Do not place live payment secrets in GitHub.
