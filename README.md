# Kivo

Kivo's source repository and automatic update channel.

## Automatic update system

Every push to `main` triggers `.github/workflows/publish-update.yml`.

GitHub Actions:
1. packages the current Kivo application,
2. creates a new numbered version,
3. publishes a GitHub Release,
4. generates release notes from the repository changes,
5. attaches `Kivo-update.zip`.

Installed desktop copies of Kivo check this repository's latest GitHub Release on startup and every 10 minutes. When a newer version exists, Settings shows **Update now**.

The updater never replaces:
- `data/`
- `uploads/`
- `updates/`
- `backups/`
- `.env`

That means an application update does not intentionally overwrite the user's local database or uploads.

## Important

Do not commit `data/kivo.db`, passwords, `.env`, private uploads, API keys, or other user data.
