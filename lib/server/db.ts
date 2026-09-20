import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getEnv } from "./env";
import { getBooks, parseReference } from "../bible";

export type Row = Record<string, string | number | null>;
export class Database {
  readonly sqlite: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    const migrationPath = join(process.cwd(), "migrations", "001_initial.sql");
    if (!existsSync(migrationPath))
      throw new Error(
        "Run the application from the VerseSite project directory.",
      );
    this.sqlite.exec(readFileSync(migrationPath, "utf8"));
  }
  one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.sqlite.prepare(sql).get(...params) as Row | undefined;
  }
  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.sqlite.prepare(sql).all(...params) as Row[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.sqlite.exec("COMMIT");
      return value;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
}

export function seedDatabase(db: Database) {
  if (db.one("SELECT id FROM users LIMIT 1")) return;
  const now = new Date().toISOString();
  db.transaction(() => {
    const users = [
      [
        "ruth",
        "ruth",
        "Ruth Ellis",
        "Finding the sacred in the ordinary. Tea, long walks, and a well-worn journal.",
        "USER",
      ],
      [
        "jonah",
        "jonah",
        "Jonah Brooks",
        "Learning to listen, one passage at a time.",
        "USER",
      ],
      [
        "maya",
        "maya",
        "Maya Chen",
        "Curious reader. There is always room for a good question.",
        "USER",
      ],
      [
        "admin",
        "eden",
        "Eden Steward",
        "Helping keep this a kind and thoughtful place.",
        "MODERATOR",
      ],
    ];
    for (const [id, username, name, bio, role] of users) {
      db.run(
        "INSERT INTO users(id,username,role,created_at) VALUES(?,?,?,?)",
        id,
        username,
        role,
        now,
      );
      db.run(
        "INSERT INTO profiles(user_id,display_name,bio) VALUES(?,?,?)",
        id,
        name,
        bio,
      );
    }
    db.run(
      "INSERT INTO friendships VALUES('jonah','ruth','ruth','ACCEPTED',?,?)",
      now,
      now,
    );
    db.run(
      "INSERT INTO friendships VALUES('maya','ruth','maya','PENDING',?,?)",
      now,
      now,
    );
    for (const book of getBooks())
      db.run(
        "INSERT OR IGNORE INTO bible_books VALUES(?,?,?,?)",
        book.id,
        book.name,
        book.order,
        book.chapterCount,
      );
    const examples = [
      [
        "quiet-moments",
        "ruth",
        "Room for a quieter kind of faith",
        "I used to think being still meant having no questions. Today I am wondering if it simply means making enough room to listen. A quiet moment before the day begins can be its own small prayer.",
        "Psalms 46:10",
        "PUBLIC",
        "APPROVED",
      ],
      [
        "small-kindness",
        "jonah",
        "A little more gentleness",
        "There is something generous about this invitation to be still. We do not have to carry everything at once. I am trying to bring that gentleness into my conversations today.",
        "Psalms 46:10",
        "PUBLIC",
        "APPROVED",
      ],
      [
        "open-question",
        "maya",
        "What does stillness look like?",
        "As someone still exploring faith, I find this verse surprisingly welcoming. Stillness feels less like having an answer and more like being willing to notice what is already here.",
        "Psalms 46:10",
        "PUBLIC",
        "APPROVED",
      ],
      [
        "friend-reflection",
        "ruth",
        "Practicing trust together",
        "Sharing this with friends as a reminder to make time for one another this week. I am grateful for conversations where we can be honest and curious together.",
        "Proverbs 3:5-6",
        "FRIENDS",
        "APPROVED",
      ],
      [
        "private-reflection",
        "ruth",
        "A page just for me",
        "Today I am leaving a little space in my schedule to sit with this passage and write without needing to have everything figured out.",
        "John 3:16",
        "PRIVATE",
        "APPROVED",
      ],
      [
        "review-example",
        "maya",
        "Awaiting a thoughtful review",
        "This is a harmless development example demonstrating the moderation review queue.",
        "John 3:16",
        "PUBLIC",
        "REVIEW",
      ],
    ];
    examples.forEach(
      ([id, author, title, body, reference, visibility, status], index) => {
        const created = new Date(
          Date.now() - (index + 1) * 3600000,
        ).toISOString();
        db.run(
          "INSERT INTO reflections(id,author_id,title,body,visibility,moderation_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          id,
          author,
          title,
          body,
          visibility,
          status,
          created,
          created,
        );
        insertPassage(db, id, reference);
      },
    );
    db.run(
      "INSERT INTO comments(id,reflection_id,author_id,body,created_at,updated_at) VALUES('seed-comment','quiet-moments','jonah',?,?,?)",
      "A quiet moment can change the shape of a whole day. Thank you for this reminder.",
      now,
      now,
    );
    db.run(
      "INSERT INTO reactions VALUES('quiet-moments','jonah','Thoughtful',?)",
      now,
    );
    db.run(
      "INSERT INTO reactions VALUES('quiet-moments','maya','Encouraging',?)",
      now,
    );
    db.run(
      "INSERT INTO reactions VALUES('small-kindness','ruth','Amen',?)",
      now,
    );
    for (let offset = -4; offset <= 7; offset++) {
      const date = new Date(Date.now() + offset * 86400000).toLocaleDateString(
        "en-CA",
        { timeZone: getEnv().SITE_TIMEZONE },
      );
      db.run(
        "INSERT OR IGNORE INTO daily_verses VALUES(?,?,'WEB',?)",
        date,
        "Psalms 46:10",
        now,
      );
    }
    db.run(
      "INSERT INTO moderation_events VALUES(?,?,?,?,?,?,?,?)",
      randomUUID(),
      "admin",
      "reflection",
      "review-example",
      "REVIEW",
      "seed-review",
      "Harmless seeded review example.",
      now,
    );
    db.run(
      "INSERT INTO notifications VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      "ruth",
      "maya",
      "FRIEND_REQUEST",
      null,
      null,
      now,
    );
  });
}

export function insertPassage(
  db: Database,
  reflectionId: string,
  reference: string,
) {
  const target = parseReference(reference);
  db.run(
    "INSERT INTO reflection_passages(id,reflection_id,book_id,start_chapter,start_verse,end_chapter,end_verse,target_type,translation,reference,target_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    randomUUID(),
    reflectionId,
    target.bookId,
    target.startChapter,
    target.startVerse,
    target.endChapter,
    target.endVerse,
    target.targetType,
    target.translationId,
    target.displayReference,
    JSON.stringify(target),
  );
}

const globalDatabase = globalThis as typeof globalThis & {
  verseDatabase?: Database;
  verseDatabasePath?: string;
};
export function getDatabase() {
  const env = getEnv();
  if (
    !globalDatabase.verseDatabase ||
    globalDatabase.verseDatabasePath !== env.DB_PATH
  ) {
    globalDatabase.verseDatabase = new Database(env.DB_PATH);
    globalDatabase.verseDatabasePath = env.DB_PATH;
    if (env.developmentAuth || env.APP_ENV === "test")
      seedDatabase(globalDatabase.verseDatabase);
  }
  return globalDatabase.verseDatabase;
}
