# Stillword

A working Bible reading and reflection community built from `codex-bible-reflection-site-prompt.md`. This project is self-contained in `AstraProj/VerseSite`; the existing `verseSite` and `ReflSite` projects are untouched.

## Run locally

Requires **Node.js 24+** (uses the built-in `node:sqlite` module). No database server, Bible API key, password, or payment credential is needed.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

On Windows, use `Copy-Item .env.example .env.local` instead of `cp`. In this workspace, `./start.ps1` also locates the existing portable Node runtime at `../../.tools/node-v24.15.0-win-x64` if Node is absent from PATH, installs missing dependencies, and starts development. A local `.env.local` is already prepared for this delivery.

Open **http://localhost:3000**. Use this exact hostname: CSRF protection compares requests to `APP_ORIGIN`. If you change port or use `127.0.0.1`, update that variable accordingly. The server binds to loopback for local development.

```sh
npm run build
npm start
```

These commands run an optimized build. Local demo authentication remains enabled only by the explicit development variables, not by `NODE_ENV`. A public production deployment must set `APP_ENV=production` and replace the auth adapter.

## What works

- Daily passage with stable timezone-based selection, curated records, historical dates, copy/share, chapter navigation, and writing entry points.
- Complete packaged public-domain World English Bible: 66 books and 1,189 chapters, no runtime internet access required. Reference aliases, verse ranges, cross-chapter ranges, chapters, and whole books. Whole-book responses paginate at 100 verses.
- Multiple reflections per passage, independent private/friends/public visibility, author editing and soft deletion, local drafts scoped to account and passage, character limits, and explicit interaction switches.
- Own-journal text, passage, book, visibility and date filters; chronological and biblical-order sorting. Public and accepted-friend feeds.
- Reciprocal friends, incoming/outgoing requests, decline/cancel, removal, blocking/unblocking, search and profiles.
- Comments with author edits/removal and reflection-author removal; four reactions with one active reaction per person. Disabled interactions retain their records while hiding their UI/counts and refusing new writes.
- Server moderation, rate limits, repeated-content detection, reports, an audited steward queue with approve/hide/dismiss and internal notes, and in-app notifications checked against current authorization.
- Persistent light/dark/system themes, mobile navigation with focus management, keyboard controls, semantic forms, live status messages, escaped plain-text rendering, and restrained local SVG artwork.
- Eight-product sample shop with visibly unavailable demo checkout. Optional real Shopify catalog and hosted checkout adapter; payment cards and journal content never enter the commerce boundary.

## Development accounts

Select an account at `/signin`. These fictional users have no passwords:

| Account      | Username | Starting relationship                                  |
| ------------ | -------- | ------------------------------------------------------ |
| Ruth Ellis   | `ruth`   | Friends with Jonah; incoming request from Maya         |
| Jonah Brooks | `jonah`  | Friends with Ruth                                      |
| Maya Chen    | `maya`   | Stranger to Ruth until the pending request is accepted |
| Eden Steward | `eden`   | Authorized moderator                                   |

Seeds include public, friends-only, private and harmless reviewed reflections, comments, reactions, notifications, and daily passages. Seeding is idempotent and does not overwrite existing users. Data lives at `DB_PATH`, default `.data/verse.sqlite`. The development picker requires **both** `APP_ENV=development` and `DEV_AUTH=true`; the defaults without environment configuration are production and disabled. Existing demo sessions are unusable after development auth is disabled.

## Architecture and provider boundaries

- `app/[[...slug]]/page.tsx` resolves the application routes. `components/site.tsx`, `reading.tsx`, and `community.tsx` provide the responsive client. They use a JSON API and import only server-side **types**.
- `app/api/[...path]/route.ts` authenticates each request, verifies the exact configured Origin on mutations, limits request size, validates strict Zod schemas, and returns private/no-store responses. Unknown reflection IDs and unauthorized IDs share the same 404 response. Public page metadata is generic; the local edition is entirely noindex.
- `lib/server/domain.ts` contains `AuthService`, repository/service interfaces, `CommunityService`, and the central `canViewReflection` policy. Every content query, comment, reaction, profile, report, notification and count applies current authorization. Moderator content access is confined to explicit audited tools.
- `lib/server/db.ts` wraps parameterized SQLite statements and transactions. `migrations/001_initial.sql` defines all minimum entities, foreign keys, canonical relationship constraints, uniqueness and indexes. `npm run db:migrate` applies schema and synchronizes the complete Bible SQL mirror; `npm run db:seed` additionally populates fictional community data. The packaged provider serves immutable Bible JSON directly.
- `lib/bible.ts` exposes structured `PassageTarget`, `BibleTextProvider`, a packaged provider, a parser, and deterministic daily selection. `reflection_passages` is a separate association with a position constraint, allowing later noncontiguous targets without rewriting `reflections`.
- `lib/server/moderation.ts` owns server-only configured terms and outcomes. The client provides a limited immediate check and debounced preview endpoint; create/edit always repeat moderation on the server. Preview requests have a separate rate-limit bucket from comments. Outcomes are ALLOW, WARN, REVIEW, BLOCK. Review items are unshared until approved. A hidden item stays hidden even when its author edits it.
- `lib/commerce.ts` exposes `CommerceProvider`, immutable demo products, and a Shopify Storefront adapter. Only variant IDs and quantities are forwarded to hosted checkout; no accounts, reflections, sensitive personalization, or card handling are involved. See [Shopify’s cart API documentation](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage).
- `lib/server/env.ts` validates environment configuration centrally. Every variable is explained in `.env.example`; secrets are never exposed through `NEXT_PUBLIC_*` variables.

## Privacy matrix

For approved, nondeleted reflections, with no block between the users:

| Viewer                                          | Private                          | Friends                          | Public                           |
| ----------------------------------------------- | -------------------------------- | -------------------------------- | -------------------------------- |
| Author                                          | Yes                              | Yes                              | Yes                              |
| Accepted reciprocal friend                      | No                               | Yes                              | Yes                              |
| Stranger                                        | No                               | No                               | Yes                              |
| Guest                                           | No                               | No                               | Yes                              |
| Moderator in normal browsing                    | No                               | Only if accepted friend          | Yes                              |
| Authorized steward in explicit moderation tools | Audited access to queued content | Audited access to queued content | Audited access to queued content |

Blocking denies content access in both directions, clears requests and friendships, and stops interactions. Review/hidden content is visible only to its author and audited moderators; deleted content is unavailable on normal routes. Privacy changes apply immediately to subsequent server queries. User-specific responses are never cached, and notification text never contains reflection excerpts. No analytics, public user-content metadata, search index, popularity ranking, or email/push preview is implemented.

Drafts use browser local storage under an account/passage key; they survive refresh and Cancel and are cleared after a successful save. They are not encrypted against someone with access to the same browser profile. Sign out and use a separate OS/browser profile on a shared device. The app does not expose another signed-in account’s drafts.

## Bible import and attribution

The full authorized dataset is already included in `data/bible-web.json`. To download and replace it from the publisher:

```sh
npm run bible:import
```

Restart the app after importing. Run `npm run db:migrate` if you also want to refresh the SQL mirror. Offline import accepts the authorized publisher VPL ZIP or TXT using `--source`. The importer validates format, canonical books, duplicate references and corpus completeness before replacing JSON. Verse text is retained exactly. See [data/ATTRIBUTION.md](data/ATTRIBUTION.md) for licensing, provenance, numbering and edition details. No copyrighted licensed translations are offered.

## Moderation and operations

Edit the server-only rules in `lib/server/moderation.ts`; keep fixtures out of client bundles. Normalization handles Unicode marks, case, common substitutions, punctuation and spaced-out blocked terms. Contextual references go to review rather than pretending a term list understands intent. The seed moderation example is harmless. Audits store actor, content identifier, rule/outcome, timestamp and optional steward note, rather than private content copies.

The rate limiter persists user and hashed-IP buckets in SQLite, with per-action limits. With `TRUST_PROXY=false`, direct connections share a conservative IP bucket because this Next.js adapter does not expose a trustworthy socket IP. Only set `TRUST_PROXY=true` behind a proxy that removes/replaces incoming `X-Forwarded-For` headers. Add distributed limiting when moving to multiple application instances.

Appeals currently go through the deployment’s site owner/steward outside the app. Configure a real support contact and response process before launch. Email/push delivery, account export/deletion, avatar upload and appeal submission are not exposed as functioning controls in this local edition. Profiles currently use initials and support nullable stored avatar metadata.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm test` runs parser, daily, domain, commerce and security tests, including a 270-case authorization matrix, revocation across endpoints, server-side moderation bypass attempts, XSS escaping, settings persistence and an API happy path.

Playwright runs against an optimized build on port 3100 using an isolated SQLite file. It uses installed Google Chrome (`channel: chrome`); install Chrome or change the config to a Playwright-managed Chromium installation. Browser tests cover the required friends-only happy path through real forms, denial for guests/strangers, draft reload, account and guest themes, mobile navigation, and desktop/mobile light/dark screenshots with no horizontal overflow or browser errors. Screenshots go to ignored `artifacts/`; traces/failures go to `test-results/`. No external service is mutated by tests.

## Before a public launch

Set `APP_ENV=production`, `DEV_AUTH=false`, HTTPS `APP_ORIGIN`, and configure the final authentication provider through `AuthService`. Supply production users and session validation; this project deliberately does not pretend a demo picker is production security. Replace local SQLite through the repository boundary if deploying to a hosted PostgreSQL service: translate SQLite DDL/upserts and migration execution, retain constraints and policy tests, and use connection pooling/backups appropriate to that deployment.

Configure optional Shopify domain and Storefront token for real products and hosted checkout, or keep the honest sample catalog. Configure a real support contact, moderation staffing, trusted proxy policy, database backups, retention policy, and final privacy terms. Generic noindex metadata is intentionally retained until public indexing is a deliberate deployment choice. Public HTML currently hydrates content through the API; public server rendering can be added later without changing the privacy rules.

The included CSP permits the framework’s inline bootstrap scripts; replace it with per-request nonces if your production threat model requires a stricter script policy. Provider-specific account lifecycle, email/push delivery and distributed infrastructure remain deployment work, not active placeholder flows.
