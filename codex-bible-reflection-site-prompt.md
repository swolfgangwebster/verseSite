# Codex Build Prompt: Bible Reflection Community

You are an expert full-stack product engineer and UI/UX designer. Build a polished, responsive web application whose primary purpose is to let people read Bible passages and privately record or selectively share their reflections, interpretations, questions, and thoughts.

Do not stop after producing a plan or static mockup. Inspect the existing repository, preserve its established architecture and conventions where reasonable, and implement the working application. If the repository is empty, scaffold a maintainable production-oriented application using Next.js App Router, TypeScript, Tailwind CSS, and accessible component primitives. Favor simple, well-tested solutions over unnecessary infrastructure.

## Product goal

Create a welcoming Bible-reflection community centered on thoughtful reading rather than argument, engagement bait, or denominational competition. The application should help users:

- Read a daily featured verse or passage.
- Write one or more reflections on that passage.
- Make each reflection private, visible only to accepted friends, or public.
- Look up any Bible verse, contiguous passage, chapter, or book and write reflections connected to it.
- Revisit their own reflections as a personal spiritual journal.
- Discover public reflections and eligible friends-only reflections.
- Optionally allow comments and/or reactions on each reflection.
- Build reciprocal friend connections with other users.
- Report abusive content and benefit from automatic offensive-language moderation.
- Visit a visually integrated shop containing reflection-oriented products without letting commerce overwhelm the core experience.

The experience must also work for curious non-Christians and users from different Christian traditions. Avoid assuming a single denomination, political identity, gender, or worship style.

## First actions

1. Inspect the repository, package manager, framework, existing routes, design system, database code, environment configuration, and tests.
2. Summarize the current state and state any implementation assumptions briefly.
3. Produce a short phased plan and then implement it.
4. Do not overwrite unrelated user work or replace a functioning stack solely to match the preferred greenfield stack above.
5. If an external credential or final infrastructure choice is unavailable, implement a clearly documented local adapter and continue. Do not leave the whole feature as a nonfunctional placeholder.

## Core information architecture

Implement these primary routes or their equivalents in the existing framework:

- `/` — daily verse home page.
- `/bible` — Bible lookup, reference search, and book/chapter navigation.
- `/bible/[reference]` — passage page with text and associated reflections.
- `/reflections` — signed-in user's journal/feed with filters.
- `/reflections/[id]` — reflection detail, comments, and reactions.
- `/write` or an inline composer — create a reflection for a selected passage.
- `/friends` — friends, incoming requests, outgoing requests, and people search.
- `/profile/[username]` — profile and reflections the current viewer is authorized to see.
- `/settings` — account, privacy defaults, theme, and notification preferences.
- `/shop` — curated shop integrated with an external commerce provider.
- `/moderation` — restricted moderation queue and reports view.
- Authentication routes appropriate to the chosen auth solution.

Use a compact responsive navigation with Home, Bible, Reflections, Friends, and Shop. Include account/settings access and a prominent but tasteful dark-mode toggle. On mobile, provide a usable menu or bottom navigation without crowding the verse content.

## Home page: daily verse

The front page should feel calm and immediately useful.

Include:

- The date and a featured daily verse or short passage.
- Book, chapter, and verse reference.
- Translation attribution.
- Controls to copy the verse, share a link, open the full chapter, and begin a reflection.
- A reflection composer for authenticated users.
- A clear sign-in invitation for guests, while still allowing guests to read the verse and public reflections.
- Tabs or filters for `Public reflections`, `Friends`, and `Mine`. Hide or disable inapplicable tabs for guests.
- Thoughtful empty states rather than filler posts.
- A link to browse prior daily verses if daily-verse history exists.

The daily verse must be stable for the configured site calendar date and must not change on each refresh. Use an administrator-curated `daily_verses` table when records exist. Provide a deterministic fallback selected from a vetted seed list. Make the site timezone configurable through `SITE_TIMEZONE`, defaulting to `America/New_York` for development.

## Bible lookup and passage model

Users must be able to find a passage by:

- Typing references such as `John 3:16`, `John 3:16-18`, `Romans 8`, or `Psalms`.
- Selecting a book, chapter, and verse from browse controls.
- Moving to the previous or next chapter.

Normalize common book aliases and minor formatting differences. Return a useful validation message for impossible references. Do not silently point to the wrong passage.

A reflection target must support:

- One verse.
- A contiguous verse range, including a range crossing chapters within one book.
- A whole chapter.
- A whole Bible book.

Store structured reference data rather than only an arbitrary reference string. Keep the canonical book identifier, start chapter/verse, optional end chapter/verse, target type, translation identifier, and a normalized display reference. Design the passage-target layer so multiple noncontiguous passages could be added later without rewriting the reflection table, but do not overbuild that feature now.

Use a legally distributable Bible source. For local development, prefer a packaged public-domain translation such as the World English Bible. Include its attribution and preserve the text accurately. Put Bible access behind a `BibleTextProvider` interface so a licensed API or another translation can be added later. Do not scrape Bible websites, ship copyrighted translation text without permission, or claim unsupported translations are available.

If the full public-domain Bible dataset cannot be committed during the first pass, implement the complete provider, import script, schema, reference parser, and navigation with a clearly labeled sample dataset. Document the one command needed to import the complete authorized dataset. The UI must not misleadingly claim that all verses are available while only sample data exists.

## Reflection creation and editing

Each authenticated user may create any number of reflections on the same passage.

A reflection should contain:

- `id`
- `authorId`
- Optional title
- Required reflection body
- One structured passage target
- `visibility`: `PRIVATE`, `FRIENDS`, or `PUBLIC`
- `commentsEnabled`
- `reactionsEnabled`
- Moderation status
- Created, updated, and optional deleted timestamps
- Optional edited indicator

Use plain text or a deliberately limited Markdown subset for the initial version. Render safely and sanitize output. Do not introduce a complex rich-text editor unless the repository already has one.

The composer should:

- Display the selected passage above the editor.
- Provide an explicit visibility selector with a plain-language explanation of each option.
- Default to the user's saved privacy preference; if no preference exists, default to `PRIVATE`.
- Include independent toggles for comments and reactions.
- Show a character count and reasonable maximum length.
- Preserve an unsent draft locally so an accidental refresh does not erase writing.
- Clearly distinguish Save, Publish, Update, and Cancel actions.
- Run client-side moderation for fast feedback, while always repeating moderation on the server.
- Never change a reflection's visibility without an explicit user action.

The author can edit, change visibility, toggle interactions, or delete their reflection. Use soft deletion when it benefits moderation and audit integrity. Confirm destructive actions.

## Privacy and authorization

Privacy rules are a hard security requirement, not merely UI filtering.

Enforce authorization on the server for every page query, API route, server action, comment, reaction, notification, search result, count, and metadata response:

- `PRIVATE`: visible only to the author and authorized moderators acting through audited moderation tools.
- `FRIENDS`: visible only to the author and users with an accepted reciprocal friendship, unless either user has blocked the other.
- `PUBLIC`: visible to any visitor unless removed, hidden by moderation, or blocked where applicable.

Private and friends-only reflection text must never appear in public feeds, search indexes, public metadata, sitemaps, Open Graph descriptions, analytics payloads, error logs, notification previews sent to unauthorized users, or aggregate endpoints from which the content could be inferred.

Changing a reflection from public to a more restrictive visibility must immediately remove it from public/friends feeds and invalidate relevant cache entries. Deleting or blocking must also revoke access immediately.

Create a centralized authorization function such as `canViewReflection(viewer, reflection)` and use it everywhere. Add exhaustive tests for the complete author/friend/stranger/guest/blocked/moderator matrix.

## Friends and blocking

Use reciprocal friendships, not ambiguous one-way followers.

Support:

- Search by display name or username.
- Send, accept, decline, and cancel a friend request.
- Remove an accepted friend.
- Block and unblock a user.
- View incoming requests, outgoing requests, and accepted friends.

Prevent duplicate and self-directed requests. Store friendships with a canonical user-pair constraint so the same relationship cannot be duplicated in reverse order. Blocking must cancel pending requests, remove an existing friendship, prevent new interactions, and hide the blocker and blocked user's content from each other where appropriate.

## Comments and reactions

The reflection author controls comments and reactions independently.

Comments:

- Are available only when `commentsEnabled` is true.
- Require authentication.
- Are permitted only when the commenter can view the reflection.
- Can be edited or deleted by their author.
- Can be removed by the reflection author or a moderator.
- Initially support either no nesting or one reply level; avoid deeply nested debates.
- Are passed through the same moderation and rate-limiting pipeline as reflections.

Reactions:

- Are available only when `reactionsEnabled` is true.
- Require authentication and permission to view the reflection.
- Use a small thoughtful set such as `Amen`, `Thoughtful`, `Encouraging`, and `Helpful`.
- Do not include downvotes or angry reactions in the first version.
- Permit one active reaction per user per reflection, with the ability to change or remove it.
- Show aggregated counts without exposing private viewer information to unauthorized users.

If an author disables comments or reactions later, retain existing records unless product policy says otherwise, but hide the interaction UI and prevent all new writes. Make the chosen behavior clear in code and tests.

## Personal reflection journal and discovery

The `/reflections` page should provide:

- A private personal-journal view.
- Filters by book, passage, visibility, date, and free-text query over the user's own reflections.
- Sorting by newest, oldest, and Biblical book order where feasible.
- Cards showing the reference, excerpt, privacy state, interaction settings, and dates.
- A clear route back to the associated Bible passage.

Public discovery should prioritize thoughtful chronological browsing rather than addictive ranking. Provide recent public reflections and an optional friends feed. Do not add follower counts, streak pressure, leaderboards, or popularity ranking unless explicitly requested later.

Search results must respect authorization. A user searching their own journal can search private text; global search should never index private or friends-only content.

## Profiles and settings

Profiles should support:

- Unique username
- Display name
- Optional avatar
- Short bio
- Join date
- Public reflection list
- Friends-only reflections only when the viewer is an accepted friend
- Friend-request, remove-friend, and block actions when appropriate

Settings should support:

- Default reflection visibility
- Default comment and reaction preferences
- Light, dark, or system theme
- Basic notification preferences
- Account deletion/export placeholders only if clearly labeled; implement them fully if exposed as active controls

Do not expose email addresses or other private account data on profiles.

## Authentication and database portability

The hosted database and final authentication provider have not been selected. Implement the basics without coupling page components directly to one vendor SDK.

Requirements:

- Define repository/service interfaces for users, Bible passages, daily verses, reflections, relationships, comments, reactions, reports, notifications, and moderation.
- If the repository has no database layer, use a local SQLite development database with migrations and seed data, while keeping the schema compatible with a future PostgreSQL deployment wherever practical.
- Keep database access on the server.
- Centralize environment parsing and validation.
- Provide `.env.example` without secrets.
- Provide a development authentication adapter or seeded demo accounts if production auth cannot be configured without external credentials.
- Clearly label development-only authentication and prevent it from silently enabling in production.
- If Auth.js or an equivalent provider-neutral solution fits the existing stack, use it; otherwise expose a small `AuthService` boundary so the final provider can be replaced.
- Never store plaintext passwords. Do not invent fake production security.

Minimum data entities:

- `User`
- `Profile`
- `Account` / `Session` as required by auth
- `Friendship`
- `Block`
- `BibleBook`
- `BibleVerse`
- `DailyVerse`
- `Reflection`
- `ReflectionPassage`
- `Comment`
- `Reaction`
- `Report`
- `ModerationEvent`
- `Notification`

Add appropriate foreign keys, uniqueness constraints, indexes, timestamps, cascading or restricted deletes, and moderation/soft-delete fields. Important indexes include reflection author/date, reflection visibility/status/date, normalized passage target, comment reflection/date, reaction reflection, report status/date, daily verse date, and friendship user pairs.

Seed development data with several users, accepted and pending friendships, public/friends/private reflections, comments, reactions, one moderation example, and several daily verses. Never use real user data in seeds.

## Moderation and community safety

Implement a lightweight but real automatic moderation layer for reflections, comments, usernames, display names, and bios.

The first version should:

- Normalize case and Unicode before matching.
- Detect configured slurs and severe targeted abuse even when separated by common punctuation or spacing.
- Keep the blocked-term configuration server-side and easy to update.
- Assign outcomes such as `ALLOW`, `WARN`, `REVIEW`, or `BLOCK`.
- Block unmistakable slurs and severe abusive phrases.
- Route ambiguous content to review rather than pretending a word list understands context.
- Return a respectful generic message without echoing the offensive term.
- Record a rule identifier, content type, actor, outcome, and timestamp in `ModerationEvent`; avoid copying private content into logs unnecessarily.
- Re-run moderation on edited content.
- Sanitize all rendered user content to prevent XSS.

Also implement:

- Per-user and per-IP rate limiting for posting, commenting, reactions, friend requests, and reports.
- A report action with reasons such as harassment, hate/slur, spam, sexual content, threat, misinformation/context concern, and other.
- A restricted moderation queue where authorized moderators can review reported or flagged public/friends content, record a decision, hide/remove content, dismiss a report, and add an internal note.
- Basic anti-spam measures, including repeated-content and rapid-post checks.
- A way to appeal or contact support can be documented for later if full workflow is out of scope.

Do not label theological disagreement as automatically offensive. Moderation should address abuse, threats, slurs, harassment, spam, and unsafe content—not enforce one interpretation of a passage.

## Shop

Add a visually integrated `/shop` page for a small curated collection of products supporting reflection and study, such as:

- Guided Bible reflection journal
- Prayer notebook
- Scripture or reflection art print
- Mug
- Tote bag
- Minimal T-shirt or crewneck
- Encouragement cards
- Sticker sheet

Keep commerce isolated from sensitive reflection data:

- Never use private reflection text to personalize products or advertising.
- Do not trigger manipulative shop prompts after a user writes about grief, fear, illness, guilt, or another vulnerable topic.
- Do not build custom card handling or store payment-card details.

Create a `CommerceProvider` boundary. Prefer Shopify Storefront API data and hosted Shopify checkout when the required public storefront configuration is available. Use environment variables for domain/token configuration. When it is unavailable, render a polished sample catalog from local typed data and clearly mark checkout as a demo or disabled state. Product cards should include an image, title, description, price, category, and accessible call to action. The shop should share the site's design system but remain secondary in the main navigation.

## Visual design

Create a simple, modern, warm interface. It should feel reflective and human, not like a generic church template or a social-media clone.

Light theme direction:

- Warm cream or parchment background
- Soft white cards
- Terracotta, muted gold, warm brown, and subtle sage accents
- Dark brown/slate body text with strong contrast
- Restrained serif type for passage text paired with a highly readable sans-serif interface font
- Gentle borders, generous spacing, modest corner radii, and soft shadows
- Minimal line-art or botanical accents used sparingly

Dark theme direction:

- Deep navy-to-indigo night-sky background
- Very subtle star texture created with CSS or a lightweight asset
- Warm gold or moonlit accent color
- Muted blue-gray cards
- High-contrast readable text
- No distracting animated starfield behind the reading surface

Theme requirements:

- Support light, dark, and system preference.
- Persist a guest's theme locally and a signed-in user's preference in their settings.
- Avoid a flash of the wrong theme on initial load.
- Ensure all controls, focus rings, borders, disabled states, charts/counts, and moderation badges work in both modes.

Use responsive layouts from small phones through desktops. Passage text should retain a comfortable reading width. On large screens, a secondary column may contain reflection filters or contextual navigation, but the verse remains primary.

## Accessibility and usability

Meet WCAG 2.2 AA as closely as practical.

Include:

- Semantic headings, landmarks, forms, and buttons.
- Full keyboard navigation and visible focus states.
- Sufficient color contrast in both themes.
- Proper labels, descriptions, validation summaries, and error messages.
- ARIA only where semantic HTML is insufficient.
- Reduced-motion support.
- Screen-reader announcements for saved reflections, reaction changes, comment submissions, and moderation errors.
- Accessible modal focus management.
- Alt text for meaningful imagery and decorative treatment for nonessential images.
- Large-enough touch targets.

Do not rely on color alone to communicate privacy, moderation state, or validation.

## Notifications

Implement an in-app notification foundation for:

- Accepted friend requests
- New friend requests
- Comments on a reflection
- Reactions on a reflection
- Replies to a comment, if replies are implemented
- Moderation actions affecting the user's content

Notifications must respect current visibility. If access is revoked, the notification must not continue exposing a reflection excerpt. Email or push delivery can remain an adapter or documented future feature unless credentials already exist.

## Error handling, security, and performance

- Validate every mutation on the server with a typed schema.
- Use parameterized ORM/database queries.
- Protect mutations against CSRF as appropriate to the framework.
- Apply secure session-cookie settings in production.
- Do not expose secrets or privileged database credentials to the browser.
- Avoid leaking private content through logs or exception-monitoring metadata.
- Paginate feeds, comments, reports, and search results.
- Use optimistic UI only where rollback behavior is clear.
- Add useful loading, empty, unauthorized, not-found, and error states.
- Cache public Bible text where safe, but do not improperly cache user-specific visibility results.
- Prevent public search-engine indexing of private, friends-only, account, settings, and moderation pages.

## Testing

Add automated tests appropriate to the stack. At minimum cover:

- Bible reference parsing and normalization.
- Daily verse stability by configured date and timezone.
- Creating multiple reflections on the same passage.
- Private, friends-only, and public authorization for guests, strangers, friends, authors, blocked users, and moderators.
- Visibility changes and cache/query invalidation.
- Friend-request lifecycle and duplicate prevention.
- Blocking behavior.
- Comments and reactions disabled/enabled behavior.
- Unique reaction enforcement.
- Moderation allow/warn/review/block outcomes.
- Server-side rejection when client-side checks are bypassed.
- Search authorization.
- Safe Markdown/text rendering.
- Theme persistence.
- Shop fallback when commerce credentials are absent.

Include at least one end-to-end happy path:

1. Sign in with a development user.
2. Find a passage.
3. Create a friends-only reflection.
4. Confirm an accepted friend can view and react.
5. Confirm a stranger and guest cannot view it.

## Documentation and delivery

Provide:

- A working application rather than disconnected component samples.
- Database migrations and development seed command.
- `.env.example` with explanations for every variable.
- A README covering setup, development, testing, data import, moderation configuration, and production-provider replacement.
- A short architecture section explaining the auth, database, Bible-text, moderation, and commerce boundaries.
- A privacy/authorization matrix in the documentation.
- Clear notes identifying demo adapters or infrastructure decisions still required before production.

Before finishing:

1. Run formatting, linting, type checking, automated tests, and the production build.
2. Fix failures introduced by the work.
3. Manually inspect the most important responsive pages in both themes.
4. Verify that no secret, private seed information, copyrighted Bible data, or offensive test fixture is rendered unintentionally.
5. Report what was implemented, important files changed, commands run, remaining production configuration, and any known limitations.

## Acceptance criteria

The build is successful when:

- A guest can read the daily verse, navigate Bible passages, view public reflections, and browse the shop.
- An authenticated user can find any available passage and create multiple reflections tied to it.
- Each reflection can independently be private, friends-only, or public.
- Server-side rules prevent unauthorized access to restricted reflections.
- Accepted friends can access friends-only reflections; strangers cannot.
- Authors can independently enable or disable comments and reactions.
- Moderation blocks configured slurs server-side and supports reports/review.
- The personal journal can be filtered and searched without leaking its contents publicly.
- The warm light theme and night-sky dark theme are polished, accessible, persistent, and responsive.
- The database and auth layers work locally and are documented for replacement with a hosted provider.
- The shop works through its configured provider or presents an honest, polished demo fallback without handling payment details itself.
- Linting, type checking, tests, and production build complete successfully.

