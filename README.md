# Daily KJV Verse

A small full-stack Bible verse reflection app built with Python, SQLite/Postgres-ready storage, user profiles, shareable posts, moderation, and static HTML/CSS/JS.

## Run Locally

```powershell
cd verseSite
$env:ADMIN_PASSWORD="choose-a-password"
$env:ADMIN_SECRET="choose-a-long-random-secret"
python server.py
```

Open `http://127.0.0.1:8011`.

The SQLite database is created automatically at `verse_site.sqlite3` on first run. If `versesAll.xlsx` is present, the app imports that local workbook as the verse source and stores KJV, NIV, AMP, and popularity rank data. If the workbook is missing, it falls back to the small built-in seed list.

## Production Hosting

This app is now set up for hosted web services such as Render, Railway, Fly, or a VPS.

Set these environment variables in production:

```text
APP_ENV=production
HOST=0.0.0.0
PORT=<provider port>
ADMIN_EMAIL=<your admin email>
ADMIN_PASSWORD=<strong password>
ADMIN_SECRET=<long random secret>
SESSION_COOKIE_SECURE=1
DATABASE_URL=<database URL>
VERSE_SOURCE_PATH=versesAll.xlsx
VERSE_TRANSLATION=KJV
```

For a small launch, `DATABASE_URL=sqlite:///verse_site.sqlite3` works if the host provides a persistent disk. For growth, use a managed Postgres database and install `psycopg[binary]` from `requirements.txt`.

If you deploy with the workbook importer, make sure `versesAll.xlsx` is included in the deployed project or set `VERSE_SOURCE_PATH` to the deployed file path. The importer runs automatically when the `verses` table is empty or still has only the small starter set. Set `VERSE_IMPORT_ALWAYS=1` to force a refresh from the workbook on startup.

## Features

- Daily KJV verse selected from the local verse database imported from `versesAll.xlsx`.
- User registration and login with signed sessions.
- Profile pages with public posts.
- Public, unlisted, or private reflections with shareable slugs.
- Anonymous or named reflections with private retrieval links.
- Paginated feeds for verse and profile pages.
- Server-side moderation filter that holds profanity, slurs, and abusive language for review.
- Soft deletion, reports, moderation audit events, and rate-limit buckets.
- Processing job table for future background workers.
- Verse Versus mode with browser-local repeat vote prevention and global SQLite vote totals.
- Trivia page with Fill in the Blank and Name the Verse modes.
- Reserved Shop page for future products or resources.
- Admin route using an admin user session or legacy `ADMIN_PASSWORD`.
- Admin moderation, daily verse override, verse management, soft delete, and Verse Versus stats.
- Warm off-white UI, dark mode, responsive layout, and soft cursor-follow glow.

## Database Tables

- `users`
- `sessions`
- `verses`
- `daily_verses`
- `reflections`
- `moderation_events`
- `post_reports`
- `processing_jobs`
- `rate_limits`
- `verse_matchups`
- `votes`
- `trivia_questions`

## Environment Variables

- `APP_ENV`: `development` or `production`.
- `HOST`: bind host. Use `0.0.0.0` in production.
- `PORT`: server port, defaults to `8011`.
- `DATABASE_URL`: defaults to local SQLite. Use managed Postgres for larger deployments.
- `VERSE_SOURCE_PATH`: local `.xlsx` verse source, defaults to `versesAll.xlsx`.
- `VERSE_TRANSLATION`: display translation loaded into `verses.text`; supported values are `KJV`, `NIV`, and `AMP`. Defaults to `KJV`.
- `VERSE_IMPORT_ALWAYS`: set to `1` to refresh verse rows from the workbook on every startup.
- `ADMIN_EMAIL`: email used to bootstrap an admin user.
- `ADMIN_USERNAME`: optional admin username.
- `ADMIN_PASSWORD`: admin bootstrap password and legacy admin password.
- `ADMIN_SECRET`: long random secret used for signed hashes and legacy admin sessions.
- `SESSION_COOKIE_SECURE`: set to `1` behind HTTPS.
- `SESSION_TTL_DAYS`: session lifetime.
- `PROCESSING_MODE`: `inline` or `queued`. Queued mode stores moderation jobs for a future worker.
- `STORAGE_BACKEND`: marker for future media storage strategy.
- `MAX_PAGE_SIZE`: maximum feed page size.
- `POST_RATE_LIMIT_MAX` / `POST_RATE_LIMIT_WINDOW_SECONDS`: post rate limiting.
- `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_SECONDS`: login/register rate limiting.

## Notes

The app still runs locally with only Python and SQLite. For scaling, the code is organized around environment-driven database/session/storage settings, indexed feeds, owned posts, and a job table so storage and background processing can move outward as the user base grows.
