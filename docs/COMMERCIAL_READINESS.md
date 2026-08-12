# Kivo Commercial Readiness Checklist

This checklist separates what already exists in the product from what should still be completed before a serious public commercial launch or acquisition close.

## Product foundation — implemented

- [x] Working user registration/login
- [x] Mobile-first user interface
- [x] Universal Inbox
- [x] Natural-text capture parser
- [x] Recurring payments/subscriptions
- [x] Payment-cycle undo
- [x] Cancel/reactivate/remove controls
- [x] Reminder engine
- [x] Kivo Money
- [x] Ask Kivo Smart v2
- [x] Typo normalization/fuzzy matching
- [x] Conversation memory/follow-ups
- [x] Optional cloud AI configuration
- [x] Search/filter/command palette
- [x] First-run onboarding
- [x] User JSON export
- [x] Free / Pro architecture
- [x] Stripe integration architecture
- [x] Owner analytics
- [x] Revenue/member analytics
- [x] Product-health analytics
- [x] PWA/installable-app support
- [x] Windows demo launcher
- [x] Docker deployment
- [x] Automatic GitHub Releases
- [x] Multi-path updater
- [x] Transactional update rollback
- [x] Static release smoke tests
- [x] Real end-to-end release test
- [x] Private owner credential path
- [x] Loopback isolation of compatibility core

## Before real customer payments

- [ ] Create/verify the intended business/payment account
- [ ] Create production Stripe products/prices
- [ ] Add production webhook signing secret
- [ ] Test successful subscription
- [ ] Test failed payment
- [ ] Test cancellation
- [ ] Test plan reactivation
- [ ] Test Billing Portal
- [ ] Verify revenue analytics against Stripe records
- [ ] Confirm tax/GST treatment with appropriate professional advice
- [ ] Review checkout wording and cancellation disclosures

## Before public internet deployment

- [ ] Production domain
- [ ] HTTPS
- [ ] `SECURE_COOKIES=true`
- [ ] Strong private owner password
- [ ] Production secret-management approach
- [ ] Managed backups
- [ ] Restore test
- [ ] Rate limiting / abuse controls
- [ ] Password-reset flow
- [ ] Email verification decision
- [ ] Error/uptime monitoring
- [ ] Production logs
- [ ] Staging environment
- [ ] File-upload security review

## Privacy / legal

- [ ] Final product owner/business entity decided
- [ ] Brand/trade-mark search completed
- [ ] Domain ownership documented
- [ ] Terms reviewed for actual launch model
- [ ] Privacy policy reviewed for actual data flows
- [ ] Account deletion/retention process implemented and documented
- [ ] Support/contact details replaced with real business details
- [ ] Australian Consumer Law/subscription flow reviewed if selling in Australia
- [ ] Third-party service terms reviewed
- [ ] IP ownership/contributor agreements reviewed
- [ ] Open-source/dependency licence audit retained for due diligence

## Native mobile conversion

- [ ] Decide native vs React Native vs Flutter vs Capacitor strategy
- [ ] Create mobile design QA matrix
- [ ] Native push notifications
- [ ] Secure device token/credential storage
- [ ] Deep links
- [ ] App icon/splash assets
- [ ] Apple developer account
- [ ] Google Play developer account
- [ ] Store privacy declarations
- [ ] Store subscription/payment-policy review
- [ ] TestFlight/internal testing
- [ ] Crash reporting
- [ ] App-store screenshots/marketing assets

## Acquisition package

- [ ] Repository clean and documented
- [ ] Release history retained
- [ ] Architecture document current
- [ ] Deployment guide current
- [ ] Security document current
- [ ] Demo script current
- [ ] Known limitations written down
- [ ] Brand/domain assets listed
- [ ] Third-party accounts listed
- [ ] Secrets transferred separately and securely
- [ ] Formal IP sale/assignment agreement
- [ ] Transfer date/version identified
- [ ] Buyer acceptance/testing period agreed if applicable

## Suggested definition of “launch ready”

For Kivo, a sensible launch-ready threshold is not “there are no possible future improvements.” It is:

1. core user flows are tested,
2. failures recover safely,
3. privacy/security assumptions are reviewed,
4. payments are reconciled correctly,
5. support/legal information is real,
6. deployment is monitored and backed up,
7. the business can actually support users after launch.

That is the standard this repository should continue moving toward.
