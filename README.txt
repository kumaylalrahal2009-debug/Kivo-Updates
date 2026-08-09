KIVO ADMIN HARD FIX
===================

This build intentionally runs on http://localhost:8388 to avoid old Kivo servers and browser service-worker caches.

Run start-kivo.bat. It will wait until the NEW server responds before opening /admin.

Admin email: owner@kivo.local
Admin password: KivoAdmin2026

The JavaScript and CSS are served with no-store caching in this beta build.

KIVO WEB — COMPLETE BUILD
=========================

WHAT IS INCLUDED
- Public Kivo marketing website
- Features / how it works / pricing / security sections
- Privacy, Terms and Support routes
- User signup + login
- Full Kivo app
- Smart subscriptions, recurrence and reminders
- Kivo Money and Ask Kivo
- Separate private /admin owner dashboard
- User statistics and 30-day signup chart
- Recent users and product activity metrics
- Docker deployment files

RUN LOCALLY
1. Double-click start-kivo.bat
2. Website: http://localhost:8188
3. App: http://localhost:8188/app
4. Admin: http://localhost:8188/admin

LOCAL ADMIN LOGIN
Email: owner@kivo.local
Password: KivoAdmin2026

CHANGE THE ADMIN PASSWORD BEFORE PUBLIC HOSTING.
You can set KIVO_ADMIN_EMAIL and KIVO_ADMIN_PASSWORD as server environment variables.

WHAT THE ADMIN DASHBOARD SHOWS
- Total registered users
- New users today / 7 days / 30 days
- Active users in the last 24 hours and 7 days
- Total/open/completed items
- Completion rate
- Money items
- Recurring items
- Reminder-enabled items
- Smart captures
- Ask Kivo usage
- 30-day signup chart
- 20 most recent users

BEFORE A REAL PUBLIC LAUNCH
- Deploy behind HTTPS
- Change admin credentials
- Use a persistent production database / backups
- Add verified email + password reset
- Add a real production notification service for alerts while the site is closed
- Add production OCR/AI for screenshots
- Replace beta Privacy/Terms with reviewed policies
- Add payment processing only when ready
- Configure domain/DNS and transactional email

LOGIN FIX NOTE
--------------
The Windows launcher now FORCE-SETS the local admin credentials on every start, so old Windows environment variables cannot override them.


LOCAL ADMIN FINAL FIX
---------------------
Email: owner@kivo.local
Password: KivoAdmin2026
These credentials are hard-set for this local build. Do NOT deploy this exact local-admin build publicly.


SUBSCRIPTION CONTROL UPDATE
---------------------------
- Paid on recurring subscriptions advances exactly one cycle.
- Back 1 cycle can reverse accidental advances, including dates advanced before this update.
- Cancel stops a subscription from appearing as an active charge.
- Reactivate is available from Inbox.
- Remove permanently deletes an item.
- Buttons lock while an update is processing to reduce accidental double-clicks.
