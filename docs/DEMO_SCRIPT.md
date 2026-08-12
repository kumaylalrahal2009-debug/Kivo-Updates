# Kivo Buyer Demo Script

This is a short product-demo flow for showing Kivo to a buyer, developer, partner or evaluator.

The goal is to demonstrate a **working product**, not just describe an idea.

## Before the meeting

- use the newest tested GitHub Release
- launch Kivo and confirm it stays responsive
- confirm Smart v2 status is Ready in Settings
- prepare a clean test account if desired
- avoid showing private API keys/payment secrets
- if showing Admin, know the private local owner login
- keep GitHub Releases open in another tab to demonstrate development history

## 1. Start with the problem

Suggested positioning:

> People keep subscriptions, return dates, appointments, receipts and reminders scattered across messages, calendars, banking apps and their own memory. Kivo gives those small pieces of life admin one place to go and surfaces them when they matter.

Then open Kivo Home.

## 2. Capture something messy

Go to Inbox and enter:

```text
Netflix 9.99 every month on the 11th remind me 1 day before
```

Press **Understand it**.

Show that Kivo creates a structured money item with:

- title
- amount
- recurrence
- due date
- reminder timing

Explain that the user did not fill out a long form first.

## 3. Show priority instead of clutter

Return Home.

Point out:

- Focus / Next Up
- reminders
- deadlines
- brief tags
- upcoming spend

Explain that Kivo is intended to answer “what needs me now?” rather than merely store a giant list.

## 4. Show recurring-payment controls

Open Money.

Demonstrate:

- Paid
- Back 1 cycle
- Cancel / Reactivate
- Remove

Explain why Back 1 cycle exists: marking a recurring charge paid should be reversible instead of permanently moving months ahead through accidental clicks.

## 5. Show Ask Kivo

Ask a deliberately messy question:

```text
wat am i payng for
```

Then follow with:

```text
when is it?
```

Then:

```text
what should i handle first?
```

This demonstrates:

- typo tolerance
- saved-data grounding
- conversation memory
- follow-up resolution
- prioritisation

If cloud AI is not configured, explain that this is Smart Local v2 running without a model API key.

## 6. Show search/command experience

Press:

```text
Ctrl + K
```

Search for a saved item or jump to Money/Ask Kivo.

This helps show that the product is designed for both desktop demo and eventual mobile/native conversion, rather than being a static mock-up.

## 7. Show installability

Open Settings.

Show:

- Smart v2 status
- membership status
- update version
- Install Kivo / PWA readiness

Explain that the current product can run as an installable web app and can later be wrapped/rebuilt as a native mobile application.

## 8. Show automatic releases

Open GitHub Releases.

Show:

- numbered versions
- generated changelog
- `Kivo update package`
- GitHub Action history

Explain that code releases are automatically validated and boot-tested before publication.

## 9. Show Admin

Open `/admin` using the private owner credentials.

Show:

- signups
- active users
- product activity
- memberships
- revenue metrics
- Smart/product health
- installed release health

Do not pretend demo revenue is real revenue unless actual Stripe billing events exist.

## 10. Finish with the acquisition story

Suggested positioning:

> This is not being sold as a sketch or a slide deck. It is a working mobile-first MVP with source code, backend, admin analytics, Smart assistant, releases, deployment path and handoff documentation. A buyer can keep developing this stack or use it as the product foundation for a native mobile build.

## Things not to claim

Avoid claiming:

- it is already live in the App Store if it is not
- Stripe is collecting real payments if it is not connected
- all privacy/security/legal work is complete
- bank accounts are connected if they are not
- revenue shown in a demo is real unless it actually is

Accurate positioning makes technical due diligence much easier and protects the credibility of the product.
