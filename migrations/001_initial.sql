PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','MODERATOR')),
 created_at TEXT NOT NULL, default_visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(default_visibility IN ('PRIVATE','FRIENDS','PUBLIC')),
 default_comments INTEGER NOT NULL DEFAULT 1, default_reactions INTEGER NOT NULL DEFAULT 1,
 theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system')), notify_friends INTEGER NOT NULL DEFAULT 1,
 notify_comments INTEGER NOT NULL DEFAULT 1, notify_reactions INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS friendships (user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_low,user_high), CHECK(user_low < user_high), CHECK(requested_by IN (user_low,user_high)));
CREATE INDEX IF NOT EXISTS friendships_high ON friendships(user_high,status);
CREATE TABLE IF NOT EXISTS blocks (blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id));
CREATE TABLE IF NOT EXISTS bible_books (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL UNIQUE, chapters INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bible_verses (book_id TEXT NOT NULL REFERENCES bible_books(id), chapter INTEGER NOT NULL, verse INTEGER NOT NULL, translation TEXT NOT NULL, text TEXT NOT NULL,
 PRIMARY KEY(book_id,chapter,verse,translation));
CREATE TABLE IF NOT EXISTS daily_verses (date TEXT PRIMARY KEY, reference TEXT NOT NULL, translation TEXT NOT NULL DEFAULT 'WEB', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','FRIENDS','PUBLIC')), comments_enabled INTEGER NOT NULL DEFAULT 1, reactions_enabled INTEGER NOT NULL DEFAULT 1,
 moderation_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(moderation_status IN ('APPROVED','REVIEW','HIDDEN')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS reflections_author_date ON reflections(author_id,created_at DESC);
CREATE INDEX IF NOT EXISTS reflections_visibility_status_date ON reflections(visibility,moderation_status,created_at DESC);
CREATE TABLE IF NOT EXISTS reflection_passages (id TEXT PRIMARY KEY, reflection_id TEXT NOT NULL REFERENCES reflections(id) ON DELETE CASCADE,
 book_id TEXT NOT NULL, start_chapter INTEGER, start_verse INTEGER, end_chapter INTEGER, end_verse INTEGER, target_type TEXT NOT NULL, translation TEXT NOT NULL,
 reference TEXT NOT NULL, target_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, UNIQUE(reflection_id,position));
CREATE INDEX IF NOT EXISTS passages_normalized ON reflection_passages(book_id,start_chapter,start_verse,end_chapter,end_verse);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, reflection_id TEXT NOT NULL REFERENCES reflections(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
 moderation_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(moderation_status IN ('APPROVED','REVIEW','HIDDEN')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS comments_reflection_date ON comments(reflection_id,created_at);
CREATE TABLE IF NOT EXISTS reactions (reflection_id TEXT NOT NULL REFERENCES reflections(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('Amen','Thoughtful','Encouraging','Helpful')), created_at TEXT NOT NULL, PRIMARY KEY(reflection_id,user_id));
CREATE INDEX IF NOT EXISTS reactions_reflection ON reactions(reflection_id);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), reflection_id TEXT REFERENCES reflections(id), comment_id TEXT REFERENCES comments(id),
 reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DISMISSED','RESOLVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((reflection_id IS NOT NULL) <> (comment_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS reports_status_date ON reports(status,created_at);
CREATE TABLE IF NOT EXISTS moderation_events (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), content_type TEXT NOT NULL, content_id TEXT, outcome TEXT NOT NULL, rule_id TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS moderation_events_date ON moderation_events(created_at);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id TEXT REFERENCES users(id),
 kind TEXT NOT NULL, reflection_id TEXT REFERENCES reflections(id) ON DELETE CASCADE, read_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notifications_user_date ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS content_fingerprints (user_id TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,fingerprint));
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
