@echo off
REM Copy this file to business-config.bat and fill it in locally/on your server.
REM NEVER upload business-config.bat to GitHub.

REM OWNER / ADMIN ACCESS
REM Required for Kivo Admin. Use your own strong password here.
set "KIVO_ADMIN_EMAIL=owner@kivo.local"
set "KIVO_ADMIN_PASSWORD=CHANGE_THIS_TO_A_PRIVATE_STRONG_PASSWORD"

REM OPTIONAL: connect Kivo to a cloud language model for the smartest Ask Kivo experience.
REM Leave these blank to use Kivo Smart Local v2 instead.
set "OPENAI_API_KEY="
set "KIVO_AI_MODEL=gpt-5-mini"
set "KIVO_AI_TIMEOUT_MS=8500"

REM Stripe secret API key for the business receiving payments.
set "STRIPE_SECRET_KEY=sk_test_REPLACE_ME"

REM Stripe webhook signing secret.
set "STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME"

REM Stripe recurring Price IDs created in your Stripe Dashboard.
set "STRIPE_PRICE_PRO_MONTHLY=price_REPLACE_MONTHLY"
set "STRIPE_PRICE_PRO_YEARLY=price_REPLACE_YEARLY"

REM Public URL Stripe should redirect customers back to after checkout.
set "KIVO_PUBLIC_URL=http://localhost:8488"

REM Display prices used in Kivo analytics/UI.
set "KIVO_PRO_MONTHLY_AUD=7.99"
set "KIVO_PRO_YEARLY_AUD=59.99"
