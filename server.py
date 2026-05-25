from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import sqlite3
import zipfile
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "verse_site.sqlite3"
DEFAULT_VERSE_SOURCE_PATH = ROOT / "versesAll.xlsx"

APP_ENV = os.environ.get("APP_ENV", "development")
HOST = os.environ.get("HOST", "0.0.0.0" if APP_ENV == "production" else "127.0.0.1")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "change-me")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "local-dev-secret")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH.as_posix()}")
VERSE_SOURCE_PATH = Path(os.environ.get("VERSE_SOURCE_PATH", DEFAULT_VERSE_SOURCE_PATH.as_posix()))
VERSE_TRANSLATION = os.environ.get("VERSE_TRANSLATION", "KJV").strip().upper()
VERSE_IMPORT_ALWAYS = os.environ.get("VERSE_IMPORT_ALWAYS", "0") == "1"
PROCESSING_MODE = os.environ.get("PROCESSING_MODE", "inline")
STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local")
SESSION_COOKIE = os.environ.get("SESSION_COOKIE", "verse_session")
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "1" if APP_ENV == "production" else "0") == "1"
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
MAX_PAGE_SIZE = int(os.environ.get("MAX_PAGE_SIZE", "25"))
MAX_JSON_BODY_BYTES = int(os.environ.get("MAX_JSON_BODY_BYTES", str(64 * 1024)))
POST_RATE_LIMIT_MAX = int(os.environ.get("POST_RATE_LIMIT_MAX", "10"))
POST_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("POST_RATE_LIMIT_WINDOW_SECONDS", "300"))
AUTH_RATE_LIMIT_MAX = int(os.environ.get("AUTH_RATE_LIMIT_MAX", "20"))
AUTH_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("AUTH_RATE_LIMIT_WINDOW_SECONDS", "300"))

DATABASE = urlparse(DATABASE_URL)
USING_POSTGRES = DATABASE.scheme in {"postgres", "postgresql"}
USING_SQLITE = not USING_POSTGRES

if USING_POSTGRES:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - only exercised in Postgres deployments.
        raise RuntimeError("Install psycopg[binary] to use a Postgres DATABASE_URL.") from exc
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError, psycopg.IntegrityError)
else:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)

BLOCKED_WORDS = {
    "fuck", "shit", "bitch", "asshole", "bastard", "cunt",
    "nigger", "faggot", "retard", "kike", "spic", "chink",
}

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PUBLIC_VISIBILITIES = {"public", "unlisted"}
ALL_VISIBILITIES = PUBLIC_VISIBILITIES | {"private"}

SEED_VERSES = [
    ("John", 3, 16, None, "John 3:16", "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."),
    ("Psalm", 23, 1, None, "Psalm 23:1", "The LORD is my shepherd; I shall not want."),
    ("Philippians", 4, 13, None, "Philippians 4:13", "I can do all things through Christ which strengtheneth me."),
    ("Romans", 8, 28, None, "Romans 8:28", "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."),
    ("Proverbs", 3, 5, 6, "Proverbs 3:5-6", "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths."),
    ("Isaiah", 40, 31, None, "Isaiah 40:31", "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."),
    ("Matthew", 11, 28, None, "Matthew 11:28", "Come unto me, all ye that labour and are heavy laden, and I will give you rest."),
    ("Psalm", 46, 10, None, "Psalm 46:10", "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth."),
    ("Jeremiah", 29, 11, None, "Jeremiah 29:11", "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end."),
    ("Micah", 6, 8, None, "Micah 6:8", "He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?"),
]


def db_sql(statement):
    return statement.replace("?", "%s") if USING_POSTGRES else statement


def sqlite_path_from_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "sqlite":
        return DEFAULT_DB_PATH
    path = unquote(parsed.path)
    if os.name == "nt" and re.match(r"^/[a-zA-Z]:", path):
        path = path[1:]
    elif os.name == "nt" and parsed.netloc == "" and path.startswith("/"):
        path = path.lstrip("/")
    resolved = Path(path)
    if not resolved.is_absolute():
        resolved = ROOT / resolved
    return resolved


def connect():
    if USING_POSTGRES:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    path = sqlite_path_from_url(DATABASE_URL)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def db_execute(con, statement, params=()):
    return con.execute(db_sql(statement), params)


def db_executemany(con, statement, rows):
    return con.executemany(db_sql(statement), rows)


def db_executescript(con, script):
    for statement in [part.strip() for part in script.split(";") if part.strip()]:
        db_execute(con, statement)


def scalar(con, statement, params=()):
    row = db_execute(con, statement, params).fetchone()
    if row is None:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def row_to_dict(row):
    return dict(row) if row else None


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def future_time(seconds):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=seconds)).replace(microsecond=0).isoformat()


def today_key():
    return dt.date.today().isoformat()


def schema_sql():
    id_col = "BIGSERIAL PRIMARY KEY" if USING_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    fk_id = "BIGINT" if USING_POSTGRES else "INTEGER"
    return f"""
        CREATE TABLE IF NOT EXISTS users (
          id {id_col},
          email TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          bio TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          role TEXT NOT NULL DEFAULT 'user',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id {id_col},
          user_id {fk_id} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          ip_hash TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT
        );
        CREATE TABLE IF NOT EXISTS verses (
          id {id_col},
          book TEXT NOT NULL,
          chapter INTEGER NOT NULL,
          verse_start INTEGER NOT NULL,
          verse_end INTEGER,
          reference TEXT NOT NULL UNIQUE,
          text TEXT NOT NULL,
          kjv_text TEXT,
          niv_text TEXT,
          amp_text TEXT,
          popularity_rank INTEGER,
          source_key TEXT,
          source_name TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS daily_verses (
          date TEXT PRIMARY KEY,
          verse_id {fk_id} NOT NULL REFERENCES verses(id),
          manual INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reflections (
          id {id_col},
          user_id {fk_id} REFERENCES users(id) ON DELETE SET NULL,
          verse_id {fk_id} NOT NULL REFERENCES verses(id),
          reference TEXT NOT NULL,
          text TEXT NOT NULL,
          display_name TEXT NOT NULL,
          anonymous INTEGER NOT NULL DEFAULT 0,
          slug TEXT UNIQUE,
          visibility TEXT NOT NULL DEFAULT 'public',
          status TEXT NOT NULL DEFAULT 'pending',
          moderation_reason TEXT,
          retrieval_token TEXT NOT NULL UNIQUE,
          edit_token TEXT NOT NULL UNIQUE,
          ip_hash TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS moderation_events (
          id {id_col},
          reflection_id {fk_id} NOT NULL REFERENCES reflections(id) ON DELETE CASCADE,
          moderator_user_id {fk_id} REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS post_reports (
          id {id_col},
          reflection_id {fk_id} NOT NULL REFERENCES reflections(id) ON DELETE CASCADE,
          reporter_user_id {fk_id} REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NOT NULL,
          details TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS processing_jobs (
          id {id_col},
          kind TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id {fk_id} NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL DEFAULT '{{}}',
          available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS rate_limits (
          bucket TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          reset_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS verse_matchups (
          id {id_col},
          verse_a_id {fk_id} NOT NULL REFERENCES verses(id),
          verse_b_id {fk_id} NOT NULL REFERENCES verses(id),
          winner_verse_id {fk_id} REFERENCES verses(id),
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS votes (
          id {id_col},
          matchup_id {fk_id} NOT NULL REFERENCES verse_matchups(id) ON DELETE CASCADE,
          verse_id {fk_id} NOT NULL REFERENCES verses(id),
          voter_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(matchup_id, voter_key)
        );
        CREATE TABLE IF NOT EXISTS trivia_questions (
          id {id_col},
          mode TEXT NOT NULL,
          verse_id {fk_id} NOT NULL REFERENCES verses(id),
          question_text TEXT,
          answer TEXT NOT NULL,
          choices_json TEXT,
          blanked_text TEXT,
          active INTEGER NOT NULL DEFAULT 1
        );
    """


def column_exists(con, table, column):
    if USING_POSTGRES:
        row = db_execute(
            con,
            "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
            (table, column),
        ).fetchone()
        return bool(row)
    return column in {row["name"] for row in db_execute(con, f"PRAGMA table_info({table})").fetchall()}


def ensure_column(con, table, column, sqlite_definition, postgres_definition=None):
    if column_exists(con, table, column):
        return
    definition = postgres_definition or sqlite_definition
    db_execute(con, f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db():
    with connect() as con:
        db_executescript(con, schema_sql())
        fk_id = "BIGINT" if USING_POSTGRES else "INTEGER"
        ensure_column(con, "reflections", "user_id", f"{fk_id} REFERENCES users(id) ON DELETE SET NULL")
        ensure_column(con, "reflections", "slug", "TEXT")
        ensure_column(con, "reflections", "visibility", "TEXT NOT NULL DEFAULT 'public'")
        ensure_column(con, "reflections", "updated_at", "TEXT")
        ensure_column(con, "reflections", "deleted_at", "TEXT")
        ensure_column(con, "reflections", "ip_hash", "TEXT")
        ensure_column(con, "users", "bio", "TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "users", "avatar_url", "TEXT")
        ensure_column(con, "users", "role", "TEXT NOT NULL DEFAULT 'user'")
        ensure_column(con, "users", "status", "TEXT NOT NULL DEFAULT 'active'")
        ensure_column(con, "verses", "kjv_text", "TEXT")
        ensure_column(con, "verses", "niv_text", "TEXT")
        ensure_column(con, "verses", "amp_text", "TEXT")
        ensure_column(con, "verses", "popularity_rank", "INTEGER")
        ensure_column(con, "verses", "source_key", "TEXT")
        ensure_column(con, "verses", "source_name", "TEXT")

        import_local_verses(con)

        if scalar(con, "SELECT COUNT(*) FROM verses") == 0:
            db_executemany(
                con,
                "INSERT INTO verses (book, chapter, verse_start, verse_end, reference, text) VALUES (?, ?, ?, ?, ?, ?)",
                SEED_VERSES,
            )

        if scalar(con, "SELECT COUNT(*) FROM trivia_questions") == 0:
            seed_trivia(con)

        ensure_reflection_slugs(con)
        ensure_indexes(con)
        bootstrap_admin(con)


def ensure_indexes(con):
    db_executescript(
        con,
        """
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_reflections_feed ON reflections(verse_id, status, visibility, id);
        CREATE INDEX IF NOT EXISTS idx_reflections_user ON reflections(user_id, id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reflections_slug_unique ON reflections(slug);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status, available_at);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON post_reports(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_votes_matchup ON votes(matchup_id, verse_id);
        CREATE INDEX IF NOT EXISTS idx_verses_popularity ON verses(popularity_rank);
        """,
    )


def resolved_verse_source_path():
    if VERSE_SOURCE_PATH.is_absolute():
        return VERSE_SOURCE_PATH
    return ROOT / VERSE_SOURCE_PATH


def selected_translation_text(row):
    translations = {
        "KJV": row.get("KJV", ""),
        "NIV": row.get("NIV", ""),
        "AMP": row.get("AMP", ""),
    }
    return translations.get(VERSE_TRANSLATION, translations["KJV"]) or translations["KJV"]


def import_local_verses(con):
    source_path = resolved_verse_source_path()
    if not source_path.exists():
        return 0
    existing_count = scalar(con, "SELECT COUNT(*) FROM verses") or 0
    if existing_count >= 1000 and not VERSE_IMPORT_ALWAYS:
        return 0
    rows = load_verse_workbook(source_path)
    if not rows:
        return 0
    imported = []
    for row in rows:
        verse_key = row.get("verse", "").strip()
        reference = row.get("verseTrad", "").strip()
        book = row.get("book", "").strip()
        chapter = safe_int(row.get("chapter"))
        parts = verse_key.split("/")
        verse_start = safe_int(parts[2] if len(parts) >= 3 else None)
        kjv_text = row.get("KJV", "").strip()
        niv_text = row.get("NIV", "").strip()
        amp_text = row.get("AMP", "").strip()
        display_text = selected_translation_text(row).strip()
        rank = safe_int(row.get("rank"))
        if not (reference and book and chapter and verse_start and display_text):
            continue
        imported.append(
            (
                book,
                chapter,
                verse_start,
                None,
                reference,
                display_text,
                kjv_text,
                niv_text,
                amp_text,
                rank,
                verse_key,
                source_path.name,
            )
        )
    if not imported:
        return 0
    if USING_POSTGRES:
        db_executemany(
            con,
            """
            INSERT INTO verses
            (book, chapter, verse_start, verse_end, reference, text, kjv_text, niv_text, amp_text, popularity_rank, source_key, source_name, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT (reference) DO UPDATE SET
              book = EXCLUDED.book,
              chapter = EXCLUDED.chapter,
              verse_start = EXCLUDED.verse_start,
              verse_end = EXCLUDED.verse_end,
              text = EXCLUDED.text,
              kjv_text = EXCLUDED.kjv_text,
              niv_text = EXCLUDED.niv_text,
              amp_text = EXCLUDED.amp_text,
              popularity_rank = EXCLUDED.popularity_rank,
              source_key = EXCLUDED.source_key,
              source_name = EXCLUDED.source_name,
              active = 1
            """,
            imported,
        )
    else:
        db_executemany(
            con,
            """
            INSERT INTO verses
            (book, chapter, verse_start, verse_end, reference, text, kjv_text, niv_text, amp_text, popularity_rank, source_key, source_name, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(reference) DO UPDATE SET
              book = excluded.book,
              chapter = excluded.chapter,
              verse_start = excluded.verse_start,
              verse_end = excluded.verse_end,
              text = excluded.text,
              kjv_text = excluded.kjv_text,
              niv_text = excluded.niv_text,
              amp_text = excluded.amp_text,
              popularity_rank = excluded.popularity_rank,
              source_key = excluded.source_key,
              source_name = excluded.source_name,
              active = 1
            """,
            imported,
        )
    return len(imported)


def safe_int(value):
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).strip()))
    except ValueError:
        return None


def load_verse_workbook(path):
    rows = load_xlsx_sheet(path, preferred_sheet="Append1")
    if not rows:
        return []
    headers = [normalize_header(value) for value in rows[0]]
    records = []
    for row in rows[1:]:
        record = {}
        for index, header in enumerate(headers):
            if header:
                record[header] = row[index] if index < len(row) else ""
        if record.get("verse") and record.get("verseTrad"):
            records.append(record)
    return records


def load_xlsx_sheet(path, preferred_sheet=None):
    ns = {
        "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships}
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared.findall("a:si", ns):
                shared_strings.append("".join(text.text or "" for text in item.findall(".//a:t", ns)))
        sheets = list(workbook.find("a:sheets", ns))
        sheet = next((s for s in sheets if s.attrib.get("name") == preferred_sheet), sheets[0] if sheets else None)
        if sheet is None:
            return []
        rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = relmap[rid]
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheet_xml = ET.fromstring(archive.read(target))
        return parse_xlsx_rows(sheet_xml, shared_strings, ns)


def parse_xlsx_rows(sheet_xml, shared_strings, ns):
    parsed = []
    for row in sheet_xml.findall(".//a:row", ns):
        values = {}
        max_index = -1
        for cell in row.findall("a:c", ns):
            index = xlsx_column_index(cell.attrib["r"])
            values[index] = xlsx_cell_value(cell, shared_strings, ns)
            max_index = max(max_index, index)
        parsed.append([values.get(i, "") for i in range(max_index + 1)])
    return parsed


def xlsx_cell_value(cell, shared_strings, ns):
    if cell.attrib.get("t") == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//a:t", ns))
    value = cell.find("a:v", ns)
    if value is None or value.text is None:
        return ""
    raw = value.text
    if cell.attrib.get("t") == "s":
        return shared_strings[int(raw)]
    return raw


def xlsx_column_index(cell_ref):
    letters = re.match(r"[A-Z]+", cell_ref).group(0)
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index - 1


def normalize_header(value):
    known = {
        "verse": "verse",
        "versetrad": "verseTrad",
        "rank": "rank",
        "niv": "NIV",
        "amp": "AMP",
        "kjv": "KJV",
        "book": "book",
        "chapter": "chapter",
    }
    key = re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())
    return known.get(key, str(value).strip())


def seed_trivia(con):
    verses = {row["reference"]: row for row in db_execute(con, "SELECT * FROM verses").fetchall()}
    blanks = [
        ("Psalm 23:1", "shepherd", "The LORD is my ________; I shall not want."),
        ("Philippians 4:13", "strengtheneth", "I can do all things through Christ which ________ me."),
        ("Psalm 46:10", "still", "Be ________, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth."),
        ("Matthew 11:28", "rest", "Come unto me, all ye that labour and are heavy laden, and I will give you ________."),
    ]
    for ref, answer, blanked in blanks:
        if ref not in verses:
            continue
        db_execute(
            con,
            "INSERT INTO trivia_questions (mode, verse_id, answer, blanked_text) VALUES ('blank', ?, ?, ?)",
            (verses[ref]["id"], answer, blanked),
        )
    references = list(verses.keys())
    for ref in ["John 3:16", "Romans 8:28", "Proverbs 3:5-6", "Micah 6:8"]:
        if ref not in verses:
            continue
        choices = [ref] + [r for r in references if r != ref][:3]
        random.shuffle(choices)
        db_execute(
            con,
            "INSERT INTO trivia_questions (mode, verse_id, question_text, answer, choices_json) VALUES ('reference', ?, ?, ?, ?)",
            (verses[ref]["id"], verses[ref]["text"], ref, json.dumps(choices)),
        )


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def unb64(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password, salt=None, iterations=260_000):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${b64(salt)}${b64(digest)}"


def verify_password(password, stored):
    try:
        algorithm, iterations, salt, digest = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), unb64(salt), int(iterations))
        return hmac.compare_digest(expected, unb64(digest))
    except Exception:
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def hash_identifier(value):
    return hmac.new(ADMIN_SECRET.encode(), str(value).encode(), hashlib.sha256).hexdigest()


def bootstrap_admin(con):
    if not ADMIN_EMAIL or not ADMIN_PASSWORD or ADMIN_PASSWORD == "change-me":
        return
    existing = db_execute(con, "SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,)).fetchone()
    if existing:
        db_execute(con, "UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", (existing["id"],))
        return
    username = os.environ.get("ADMIN_USERNAME", "admin").strip() or "admin"
    if not USERNAME_RE.match(username):
        username = "admin"
    if db_execute(con, "SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        username = f"admin_{secrets.token_hex(2)}"
    db_execute(
        con,
        """
        INSERT INTO users (email, username, display_name, password_hash, role, status)
        VALUES (?, ?, ?, ?, 'admin', 'active')
        """,
        (ADMIN_EMAIL, username.lower(), "Admin", hash_password(ADMIN_PASSWORD)),
    )


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:72].strip("-") or "post"


def unique_slug(con, base):
    root = slugify(base)
    for _ in range(20):
        slug = f"{root}-{secrets.token_hex(3)}"
        if not db_execute(con, "SELECT 1 FROM reflections WHERE slug = ?", (slug,)).fetchone():
            return slug
    return f"{root}-{secrets.token_urlsafe(8)}"


def ensure_reflection_slugs(con):
    rows = db_execute(con, "SELECT id, reference, display_name FROM reflections WHERE slug IS NULL OR slug = ''").fetchall()
    for row in rows:
        slug = unique_slug(con, f"{row['reference']} {row['display_name']} {row['id']}")
        db_execute(con, "UPDATE reflections SET slug = ? WHERE id = ?", (slug, row["id"]))


def contains_blocked_language(text):
    lowered = text.lower()
    return any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in BLOCKED_WORDS)


def public_name(display_name, anonymous):
    if anonymous:
        return "Anonymous"
    return display_name.strip()[:80] or "Anonymous"


def auth_digest():
    return hmac.new(ADMIN_SECRET.encode(), ADMIN_PASSWORD.encode(), hashlib.sha256).hexdigest()


def legacy_admin_signed_in(cookie):
    return f"admin_session={auth_digest()}" in (cookie or "")


def parse_cookie(cookie_header, name):
    cookie = SimpleCookie()
    cookie.load(cookie_header or "")
    morsel = cookie.get(name)
    return morsel.value if morsel else ""


def session_cookie_header(token, max_age=None):
    parts = [f"{SESSION_COOKIE}={token}", "HttpOnly", "SameSite=Lax", "Path=/"]
    if max_age is not None:
        parts.append(f"Max-Age={max_age}")
    if SESSION_COOKIE_SECURE:
        parts.append("Secure")
    return "; ".join(parts)


def clear_session_cookie_header():
    return session_cookie_header("", 0)


def serialize_user(row, private=False):
    if not row:
        return None
    data = row_to_dict(row)
    payload = {
        "id": data["id"],
        "username": data["username"],
        "display_name": data["display_name"],
        "bio": data.get("bio") or "",
        "avatar_url": data.get("avatar_url"),
        "role": data.get("role", "user") if private else None,
        "created_at": data.get("created_at"),
    }
    if private:
        payload["email"] = data["email"]
        payload["status"] = data.get("status", "active")
    else:
        payload.pop("role", None)
    return payload


def serialize_post(row):
    data = row_to_dict(row)
    if not data:
        return None
    anonymous = bool(data.get("anonymous"))
    author_name = "Anonymous" if anonymous else (data.get("user_display_name") or data.get("display_name") or "Anonymous")
    author_username = None if anonymous else data.get("username")
    return {
        "id": data["id"],
        "slug": data.get("slug"),
        "url": f"/post.html?slug={quote(data.get('slug') or '')}",
        "reference": data["reference"],
        "text": data["text"],
        "display_name": author_name,
        "username": author_username,
        "anonymous": anonymous,
        "visibility": data.get("visibility", "public"),
        "status": data.get("status", "pending"),
        "created_at": data.get("created_at"),
    }


def clamp_limit(value):
    try:
        return max(1, min(MAX_PAGE_SIZE, int(value)))
    except (TypeError, ValueError):
        return min(10, MAX_PAGE_SIZE)


def select_public_posts(con, *, verse_id=None, user_id=None, before_id=None, limit=10):
    conditions = ["r.status = 'approved'", "r.visibility = 'public'", "r.deleted_at IS NULL"]
    params = []
    if verse_id:
        conditions.append("r.verse_id = ?")
        params.append(verse_id)
    if user_id:
        conditions.append("r.user_id = ?")
        params.append(user_id)
    if before_id:
        conditions.append("r.id < ?")
        params.append(before_id)
    params.append(limit + 1)
    rows = db_execute(
        con,
        f"""
        SELECT r.*, u.username, u.display_name AS user_display_name
        FROM reflections r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE {' AND '.join(conditions)}
        ORDER BY r.id DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()
    has_more = len(rows) > limit
    posts = rows[:limit]
    next_before_id = posts[-1]["id"] if has_more and posts else None
    return {"posts": [serialize_post(row) for row in posts], "next_before_id": next_before_id}


def get_daily_verse(con):
    today = today_key()
    row = db_execute(
        con,
        "SELECT v.* FROM daily_verses d JOIN verses v ON v.id = d.verse_id WHERE d.date = ?",
        (today,),
    ).fetchone()
    if row:
        return row
    verses = db_execute(con, "SELECT * FROM verses WHERE active = 1 ORDER BY id").fetchall()
    if not verses:
        raise ValueError("No active verses are available.")
    rng = random.Random(today)
    verse = rng.choice(verses)
    db_execute(con, "INSERT INTO daily_verses (date, verse_id) VALUES (?, ?)", (today, verse["id"]))
    return verse


def create_session(con, user_id, ip_hash=None, user_agent=None):
    token = secrets.token_urlsafe(36)
    expires_at = future_time(SESSION_TTL_DAYS * 24 * 60 * 60)
    db_execute(
        con,
        """
        INSERT INTO sessions (user_id, token_hash, expires_at, ip_hash, user_agent, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, token_hash(token), expires_at, ip_hash, (user_agent or "")[:300], utc_now()),
    )
    return token


def find_user_for_session(con, token):
    if not token:
        return None
    row = db_execute(
        con,
        """
        SELECT u.*
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
        """,
        (token_hash(token), utc_now()),
    ).fetchone()
    if row:
        db_execute(con, "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (utc_now(), token_hash(token)))
    return row


def upsert_daily_verse(con, verse_id):
    if USING_POSTGRES:
        db_execute(
            con,
            """
            INSERT INTO daily_verses (date, verse_id, manual)
            VALUES (?, ?, 1)
            ON CONFLICT (date) DO UPDATE SET verse_id = EXCLUDED.verse_id, manual = 1
            """,
            (today_key(), verse_id),
        )
    else:
        db_execute(
            con,
            "INSERT OR REPLACE INTO daily_verses (date, verse_id, manual) VALUES (?, ?, 1)",
            (today_key(), verse_id),
        )


def record_moderation_event(con, reflection_id, action, reason=None, moderator_user_id=None):
    db_execute(
        con,
        """
        INSERT INTO moderation_events (reflection_id, moderator_user_id, action, reason)
        VALUES (?, ?, ?, ?)
        """,
        (reflection_id, moderator_user_id, action, reason),
    )


def enqueue_job(con, kind, entity_type, entity_id, payload=None):
    db_execute(
        con,
        """
        INSERT INTO processing_jobs (kind, entity_type, entity_id, payload_json)
        VALUES (?, ?, ?, ?)
        """,
        (kind, entity_type, entity_id, json.dumps(payload or {})),
    )


def check_rate_limit(con, bucket, max_count, window_seconds):
    now = utc_now()
    row = db_execute(con, "SELECT * FROM rate_limits WHERE bucket = ?", (bucket,)).fetchone()
    if not row or row["reset_at"] <= now:
        db_execute(con, "DELETE FROM rate_limits WHERE bucket = ?", (bucket,))
        db_execute(
            con,
            "INSERT INTO rate_limits (bucket, count, reset_at, updated_at) VALUES (?, 1, ?, ?)",
            (bucket, future_time(window_seconds), now),
        )
        return True
    if row["count"] >= max_count:
        return False
    db_execute(
        con,
        "UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?",
        (now, bucket),
    )
    return True


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def json(self, payload, status=HTTPStatus.OK, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_JSON_BODY_BYTES:
            raise ValueError("Request body is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        return (forwarded.split(",")[0].strip() or self.client_address[0])[:80]

    def client_bucket(self, action):
        return hash_identifier(f"{action}:{self.client_ip()}")

    def current_user(self, con):
        token = parse_cookie(self.headers.get("Cookie"), SESSION_COOKIE)
        return find_user_for_session(con, token)

    def require_user(self, con):
        user = self.current_user(con)
        if not user:
            self.json({"error": "Please sign in first."}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def require_admin(self, con):
        user = self.current_user(con)
        if user and user["role"] in {"admin", "moderator"}:
            return user
        if legacy_admin_signed_in(self.headers.get("Cookie")):
            return None
        self.json({"error": "Admin access required."}, HTTPStatus.UNAUTHORIZED)
        return False

    def handle_api_get(self, parsed):
        try:
            with connect() as con:
                qs = parse_qs(parsed.query)
                if parsed.path == "/api/health":
                    self.json({
                        "ok": True,
                        "database": "postgres" if USING_POSTGRES else "sqlite",
                        "processing_mode": PROCESSING_MODE,
                        "storage_backend": STORAGE_BACKEND,
                    })
                elif parsed.path == "/api/auth/me":
                    self.json({"user": serialize_user(self.current_user(con), private=True)})
                elif parsed.path == "/api/daily":
                    self.json({"verse": row_to_dict(get_daily_verse(con))})
                elif parsed.path == "/api/reflections":
                    verse_id = int(qs.get("verse_id", ["0"])[0])
                    before_id = int(qs.get("before_id", ["0"])[0] or 0)
                    limit = clamp_limit(qs.get("limit", ["10"])[0])
                    payload = select_public_posts(con, verse_id=verse_id, before_id=before_id, limit=limit)
                    self.json({"reflections": payload["posts"], "next_before_id": payload["next_before_id"]})
                elif parsed.path == "/api/posts/by-slug":
                    slug = qs.get("slug", [""])[0]
                    row = db_execute(
                        con,
                        """
                        SELECT r.*, u.username, u.display_name AS user_display_name
                        FROM reflections r
                        LEFT JOIN users u ON u.id = r.user_id
                        WHERE r.slug = ? AND r.deleted_at IS NULL
                        """,
                        (slug,),
                    ).fetchone()
                    if not row or row["status"] != "approved" or row["visibility"] not in PUBLIC_VISIBILITIES:
                        self.json({"error": "Post not found."}, HTTPStatus.NOT_FOUND)
                    else:
                        self.json({"post": serialize_post(row)})
                elif parsed.path == "/api/reflections/private":
                    token = qs.get("token", [""])[0]
                    row = db_execute(
                        con,
                        """
                        SELECT r.*, u.username, u.display_name AS user_display_name
                        FROM reflections r
                        LEFT JOIN users u ON u.id = r.user_id
                        WHERE r.retrieval_token = ? AND r.deleted_at IS NULL
                        """,
                        (token,),
                    ).fetchone()
                    if not row:
                        self.json({"error": "Reflection not found."}, HTTPStatus.NOT_FOUND)
                    else:
                        self.json({"reflection": serialize_post(row) | {"retrieval_token": token}})
                elif parsed.path == "/api/profile":
                    username = qs.get("username", [""])[0].strip().lower()
                    user = db_execute(con, "SELECT * FROM users WHERE username = ? AND status = 'active'", (username,)).fetchone()
                    if not user:
                        self.json({"error": "Profile not found."}, HTTPStatus.NOT_FOUND)
                    else:
                        before_id = int(qs.get("before_id", ["0"])[0] or 0)
                        limit = clamp_limit(qs.get("limit", ["10"])[0])
                        posts = select_public_posts(con, user_id=user["id"], before_id=before_id, limit=limit)
                        self.json({"user": serialize_user(user), **posts})
                elif parsed.path == "/api/versus/current":
                    voter_key = qs.get("voter_key", [""])[0]
                    self.json(get_current_matchup(con, voter_key, self.current_user(con)))
                elif parsed.path == "/api/trivia/next":
                    mode = qs.get("mode", ["blank"])[0]
                    random_fn = "random()" if USING_POSTGRES else "RANDOM()"
                    row = db_execute(
                        con,
                        f"SELECT tq.*, v.text, v.reference FROM trivia_questions tq JOIN verses v ON v.id = tq.verse_id WHERE tq.mode = ? AND tq.active = 1 ORDER BY {random_fn} LIMIT 1",
                        (mode,),
                    ).fetchone()
                    payload = row_to_dict(row)
                    payload["choices"] = json.loads(payload["choices_json"] or "[]")
                    self.json(payload)
                elif parsed.path == "/api/admin/dashboard":
                    if self.require_admin(con) is False:
                        return
                    self.json(admin_dashboard(con))
                else:
                    self.json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_api_post(self, parsed):
        try:
            data = self.read_json()
            with connect() as con:
                if parsed.path == "/api/auth/register":
                    if not check_rate_limit(con, self.client_bucket("register"), AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_SECONDS):
                        self.json({"error": "Too many account attempts. Please wait a bit."}, HTTPStatus.TOO_MANY_REQUESTS)
                        return
                    self.handle_register(con, data)
                elif parsed.path == "/api/auth/login":
                    if not check_rate_limit(con, self.client_bucket("login"), AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_SECONDS):
                        self.json({"error": "Too many sign-in attempts. Please wait a bit."}, HTTPStatus.TOO_MANY_REQUESTS)
                        return
                    self.handle_login(con, data)
                elif parsed.path == "/api/auth/logout":
                    token = parse_cookie(self.headers.get("Cookie"), SESSION_COOKIE)
                    if token:
                        db_execute(con, "DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
                    self.json({"ok": True}, headers={"Set-Cookie": clear_session_cookie_header()})
                elif parsed.path == "/api/users/me":
                    user = self.require_user(con)
                    if user:
                        self.handle_profile_update(con, user, data)
                elif parsed.path == "/api/reflections":
                    if not check_rate_limit(con, self.client_bucket("post"), POST_RATE_LIMIT_MAX, POST_RATE_LIMIT_WINDOW_SECONDS):
                        self.json({"error": "You are posting quickly. Please wait a bit."}, HTTPStatus.TOO_MANY_REQUESTS)
                        return
                    self.handle_reflection_create(con, data)
                elif parsed.path == "/api/posts/report":
                    self.handle_report(con, data)
                elif parsed.path == "/api/versus/vote":
                    user = self.current_user(con)
                    raw_key = data.get("voter_key") or self.client_ip()
                    voter_key = f"user:{user['id']}" if user else f"guest:{hash_identifier(raw_key)[:40]}"
                    self.json(record_vote(con, int(data["matchup_id"]), int(data["verse_id"]), voter_key))
                elif parsed.path == "/api/trivia/check":
                    row = db_execute(con, "SELECT answer FROM trivia_questions WHERE id = ?", (int(data["id"]),)).fetchone()
                    answer = row["answer"] if row else ""
                    correct = normalize(data.get("answer", "")) == normalize(answer)
                    self.json({"correct": correct, "answer": answer})
                elif parsed.path == "/api/admin/login":
                    self.handle_admin_login(con, data)
                elif parsed.path.startswith("/api/admin/"):
                    admin = self.require_admin(con)
                    if admin is False:
                        return
                    self.handle_admin_post(con, parsed.path, data, admin)
                else:
                    self.json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
        except DB_INTEGRITY_ERRORS:
            self.json({"error": "That value is already in use or this action was already recorded."}, HTTPStatus.CONFLICT)
        except ValueError as exc:
            self.json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_register(self, con, data):
        email = (data.get("email") or "").strip().lower()
        username = (data.get("username") or "").strip().lower()
        display_name = (data.get("display_name") or username).strip()[:80]
        password = data.get("password") or ""
        if not EMAIL_RE.match(email):
            raise ValueError("Enter a valid email address.")
        if not USERNAME_RE.match(username):
            raise ValueError("Usernames must be 3-24 letters, numbers, or underscores.")
        if len(password) < 8:
            raise ValueError("Passwords must be at least 8 characters.")
        role = "admin" if os.environ.get("ALLOW_FIRST_USER_ADMIN") == "1" and scalar(con, "SELECT COUNT(*) FROM users") == 0 else "user"
        db_execute(
            con,
            """
            INSERT INTO users (email, username, display_name, password_hash, role)
            VALUES (?, ?, ?, ?, ?)
            """,
            (email, username, display_name or username, hash_password(password), role),
        )
        user = db_execute(con, "SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        token = create_session(con, user["id"], hash_identifier(self.client_ip()), self.headers.get("User-Agent"))
        self.json(
            {"user": serialize_user(user, private=True)},
            status=HTTPStatus.CREATED,
            headers={"Set-Cookie": session_cookie_header(token, SESSION_TTL_DAYS * 24 * 60 * 60)},
        )

    def handle_login(self, con, data):
        login = (data.get("login") or data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        user = db_execute(
            con,
            "SELECT * FROM users WHERE (email = ? OR username = ?) AND status = 'active'",
            (login, login),
        ).fetchone()
        if not user or not verify_password(password, user["password_hash"]):
            self.json({"error": "Those credentials did not work."}, HTTPStatus.UNAUTHORIZED)
            return
        token = create_session(con, user["id"], hash_identifier(self.client_ip()), self.headers.get("User-Agent"))
        self.json(
            {"user": serialize_user(user, private=True)},
            headers={"Set-Cookie": session_cookie_header(token, SESSION_TTL_DAYS * 24 * 60 * 60)},
        )

    def handle_profile_update(self, con, user, data):
        display_name = (data.get("display_name") or user["display_name"]).strip()[:80]
        bio = (data.get("bio") or "").strip()[:500]
        avatar_url = (data.get("avatar_url") or "").strip()[:500] or None
        db_execute(
            con,
            "UPDATE users SET display_name = ?, bio = ?, avatar_url = ?, updated_at = ? WHERE id = ?",
            (display_name, bio, avatar_url, utc_now(), user["id"]),
        )
        updated = db_execute(con, "SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        self.json({"user": serialize_user(updated, private=True)})

    def handle_reflection_create(self, con, data):
        text = (data.get("text") or "").strip()
        if len(text) < 8:
            raise ValueError("Reflection text must be at least 8 characters.")
        if len(text) > 3000:
            raise ValueError("Reflection text must be 3000 characters or less.")
        verse = db_execute(con, "SELECT * FROM verses WHERE id = ? AND active = 1", (int(data["verse_id"]),)).fetchone()
        if not verse:
            self.json({"error": "Verse not found."}, HTTPStatus.NOT_FOUND)
            return
        user = self.current_user(con)
        anonymous = 1 if data.get("anonymous") else 0
        visibility = data.get("visibility") if data.get("visibility") in ALL_VISIBILITIES else "public"
        display_name = public_name(user["display_name"] if user else data.get("display_name", ""), anonymous)
        if PROCESSING_MODE == "queued":
            status = "pending"
            reason = "Queued for moderation"
        else:
            status = "held" if contains_blocked_language(text) else "approved"
            reason = "Filtered language" if status == "held" else None
        retrieval_token = secrets.token_urlsafe(24)
        edit_token = secrets.token_urlsafe(24)
        slug = unique_slug(con, f"{verse['reference']} {display_name}")
        db_execute(
            con,
            """
            INSERT INTO reflections
            (user_id, verse_id, reference, text, display_name, anonymous, slug, visibility, status, moderation_reason, retrieval_token, edit_token, ip_hash, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"] if user else None,
                verse["id"],
                verse["reference"],
                text,
                display_name,
                anonymous,
                slug,
                visibility,
                status,
                reason,
                retrieval_token,
                edit_token,
                hash_identifier(self.client_ip()),
                utc_now(),
            ),
        )
        reflection = db_execute(con, "SELECT * FROM reflections WHERE slug = ?", (slug,)).fetchone()
        record_moderation_event(con, reflection["id"], "created", reason)
        if PROCESSING_MODE == "queued":
            enqueue_job(con, "moderate_reflection", "reflection", reflection["id"], {"slug": slug})
        self.json({
            "status": status,
            "slug": slug,
            "url": f"/post.html?slug={quote(slug)}",
            "retrieval_token": retrieval_token,
            "private_url": f"/reflection.html?token={quote(retrieval_token)}",
        })

    def handle_report(self, con, data):
        slug = (data.get("slug") or "").strip()
        reason = (data.get("reason") or "Reported by user").strip()[:200]
        post = db_execute(con, "SELECT * FROM reflections WHERE slug = ? AND deleted_at IS NULL", (slug,)).fetchone()
        if not post:
            self.json({"error": "Post not found."}, HTTPStatus.NOT_FOUND)
            return
        user = self.current_user(con)
        db_execute(
            con,
            "INSERT INTO post_reports (reflection_id, reporter_user_id, reason, details) VALUES (?, ?, ?, ?)",
            (post["id"], user["id"] if user else None, reason, (data.get("details") or "").strip()[:1000]),
        )
        self.json({"ok": True})

    def handle_admin_login(self, con, data):
        password = data.get("password") or ""
        login = (data.get("login") or data.get("email") or "").strip().lower()
        user = None
        if login:
            user = db_execute(
                con,
                "SELECT * FROM users WHERE (email = ? OR username = ?) AND role IN ('admin', 'moderator') AND status = 'active'",
                (login, login),
            ).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                self.json({"error": "That admin login did not work."}, HTTPStatus.UNAUTHORIZED)
                return
        elif hmac.compare_digest(password, ADMIN_PASSWORD):
            user = db_execute(con, "SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1").fetchone()
            if not user:
                self.json({"ok": True}, headers={"Set-Cookie": f"admin_session={auth_digest()}; HttpOnly; SameSite=Lax; Path=/"})
                return
        else:
            self.json({"error": "That password did not work."}, HTTPStatus.UNAUTHORIZED)
            return
        token = create_session(con, user["id"], hash_identifier(self.client_ip()), self.headers.get("User-Agent"))
        self.json({"ok": True, "user": serialize_user(user, private=True)}, headers={"Set-Cookie": session_cookie_header(token, SESSION_TTL_DAYS * 24 * 60 * 60)})

    def handle_admin_post(self, con, path, data, admin):
        admin_id = admin["id"] if admin else None
        if path.startswith("/api/admin/reflections/"):
            reflection_id = int(path.rsplit("/", 1)[-1])
            action = data.get("action")
            if action == "delete":
                db_execute(
                    con,
                    "UPDATE reflections SET status = 'removed', deleted_at = ?, updated_at = ? WHERE id = ?",
                    (utc_now(), utc_now(), reflection_id),
                )
            elif action in {"approve", "reject"}:
                db_execute(
                    con,
                    "UPDATE reflections SET status = ?, updated_at = ? WHERE id = ?",
                    ("approved" if action == "approve" else "rejected", utc_now(), reflection_id),
                )
            record_moderation_event(con, reflection_id, action, data.get("reason"), admin_id)
            self.json({"ok": True})
        elif path == "/api/admin/daily":
            upsert_daily_verse(con, int(data["verse_id"]))
            self.json({"ok": True})
        elif path == "/api/admin/verses":
            values = (
                data["book"], int(data["chapter"]), int(data["verse_start"]),
                int(data["verse_end"]) if data.get("verse_end") else None,
                data["reference"], data["text"],
            )
            if data.get("id"):
                db_execute(
                    con,
                    "UPDATE verses SET book=?, chapter=?, verse_start=?, verse_end=?, reference=?, text=?, kjv_text=?, source_name=? WHERE id=?",
                    values + (data["text"], "admin", int(data["id"])),
                )
            else:
                db_execute(
                    con,
                    "INSERT INTO verses (book, chapter, verse_start, verse_end, reference, text, kjv_text, source_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    values + (data["text"], "admin"),
                )
            self.json({"ok": True})
        elif path == "/api/admin/verses/delete":
            db_execute(con, "UPDATE verses SET active = 0 WHERE id = ?", (int(data["id"]),))
            self.json({"ok": True})
        else:
            self.json({"error": "Not found."}, HTTPStatus.NOT_FOUND)


def normalize(value):
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def get_current_matchup(con, voter_key, user=None):
    effective_key = f"user:{user['id']}" if user else f"guest:{hash_identifier(voter_key)[:40]}"
    row = db_execute(con, "SELECT * FROM verse_matchups WHERE active = 1 ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        row = create_matchup(con)
    voted = bool(effective_key and db_execute(con, "SELECT 1 FROM votes WHERE matchup_id = ? AND voter_key = ?", (row["id"], effective_key)).fetchone())
    return matchup_payload(con, row["id"], voted)


def create_matchup(con, carry_verse_id=None):
    random_fn = "random()" if USING_POSTGRES else "RANDOM()"
    if carry_verse_id:
        verse_a = db_execute(con, "SELECT * FROM verses WHERE id = ?", (carry_verse_id,)).fetchone()
        verse_b = db_execute(con, f"SELECT * FROM verses WHERE active = 1 AND id != ? ORDER BY {random_fn} LIMIT 1", (carry_verse_id,)).fetchone()
    else:
        pair = db_execute(con, f"SELECT * FROM verses WHERE active = 1 ORDER BY {random_fn} LIMIT 2").fetchall()
        verse_a, verse_b = pair[0], pair[1]
    db_execute(con, "INSERT INTO verse_matchups (verse_a_id, verse_b_id) VALUES (?, ?)", (verse_a["id"], verse_b["id"]))
    if USING_POSTGRES:
        return db_execute(con, "SELECT * FROM verse_matchups ORDER BY id DESC LIMIT 1").fetchone()
    return db_execute(con, "SELECT * FROM verse_matchups WHERE id = last_insert_rowid()").fetchone()


def record_vote(con, matchup_id, verse_id, voter_key):
    db_execute(con, "INSERT INTO votes (matchup_id, verse_id, voter_key) VALUES (?, ?, ?)", (matchup_id, verse_id, voter_key))
    totals = vote_totals(con, matchup_id)
    winner = max(totals["items"], key=lambda item: item["votes"])
    db_execute(con, "UPDATE verse_matchups SET winner_verse_id = ?, active = 0 WHERE id = ?", (winner["verse_id"], matchup_id))
    create_matchup(con, winner["verse_id"])
    return matchup_payload(con, matchup_id, True)


def matchup_payload(con, matchup_id, voted):
    matchup = db_execute(
        con,
        """
        SELECT m.*, a.reference a_reference, a.text a_text, b.reference b_reference, b.text b_text
        FROM verse_matchups m
        JOIN verses a ON a.id = m.verse_a_id
        JOIN verses b ON b.id = m.verse_b_id
        WHERE m.id = ?
        """,
        (matchup_id,),
    ).fetchone()
    return {
        "voted": voted,
        "matchup": {
            "id": matchup["id"],
            "verse_a": {"id": matchup["verse_a_id"], "reference": matchup["a_reference"], "text": matchup["a_text"]},
            "verse_b": {"id": matchup["verse_b_id"], "reference": matchup["b_reference"], "text": matchup["b_text"]},
        },
        "totals": vote_totals(con, matchup_id),
    }


def vote_totals(con, matchup_id):
    rows = db_execute(
        con,
        """
        SELECT v.id verse_id, v.reference, COUNT(votes.id) votes
        FROM verse_matchups m
        JOIN verses v ON v.id IN (m.verse_a_id, m.verse_b_id)
        LEFT JOIN votes ON votes.matchup_id = m.id AND votes.verse_id = v.id
        WHERE m.id = ?
        GROUP BY v.id, v.reference
        """,
        (matchup_id,),
    ).fetchall()
    items = [row_to_dict(r) for r in rows]
    return {"total": sum(item["votes"] for item in items), "items": items}


def admin_dashboard(con):
    reflections = db_execute(
        con,
        """
        SELECT r.*, u.username, u.display_name AS user_display_name
        FROM reflections r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.status IN ('pending', 'held', 'rejected') AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC
        LIMIT 100
        """,
    ).fetchall()
    verses = db_execute(
        con,
        """
        SELECT * FROM verses
        WHERE active = 1
        ORDER BY COALESCE(popularity_rank, 999999), book, chapter, verse_start
        LIMIT 1000
        """,
    ).fetchall()
    verse_count = scalar(con, "SELECT COUNT(*) FROM verses WHERE active = 1") or 0
    stats = db_execute(
        con,
        """
        SELECT verses.reference, COUNT(votes.id) votes
        FROM verses
        LEFT JOIN votes ON votes.verse_id = verses.id
        GROUP BY verses.id
        ORDER BY votes DESC, verses.reference
        LIMIT 20
        """,
    ).fetchall()
    post_counts = db_execute(
        con,
        "SELECT status, COUNT(*) count FROM reflections WHERE deleted_at IS NULL GROUP BY status ORDER BY status",
    ).fetchall()
    job_counts = db_execute(
        con,
        "SELECT status, COUNT(*) count FROM processing_jobs GROUP BY status ORDER BY status",
    ).fetchall()
    reports = db_execute(
        con,
        """
        SELECT pr.*, r.slug, r.reference
        FROM post_reports pr
        JOIN reflections r ON r.id = pr.reflection_id
        WHERE pr.status = 'open'
        ORDER BY pr.created_at DESC
        LIMIT 50
        """,
    ).fetchall()
    return {
        "reflections": [serialize_post(r) for r in reflections],
        "verses": [row_to_dict(v) for v in verses],
        "verse_count": verse_count,
        "versus_stats": [row_to_dict(s) for s in stats],
        "post_counts": [row_to_dict(r) for r in post_counts],
        "job_counts": [row_to_dict(r) for r in job_counts],
        "reports": [row_to_dict(r) for r in reports],
    }


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8011"))
    print(f"Serving Daily Verse at http://{HOST}:{port}", flush=True)
    ThreadingHTTPServer((HOST, port), Handler).serve_forever()
