import { Database, seedDatabase } from "../lib/server/db";
import { getEnv } from "../lib/server/env";
import { existsSync } from "node:fs";
import { getBooks, getPassage } from "../lib/bible";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const command = process.argv[2] || "migrate";
const env = getEnv();
const db = new Database(env.DB_PATH);
// The packaged provider serves immutable text; this mirror makes a hosted SQL provider straightforward.
db.transaction(() => {
  for (const book of getBooks()) {
    db.run(
      "INSERT INTO bible_books VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,chapters=excluded.chapters",
      book.id,
      book.name,
      book.order,
      book.chapterCount,
    );
    for (const verse of getPassage(book.name).verses)
      db.run(
        "INSERT INTO bible_verses VALUES(?,?,?,'WEB',?) ON CONFLICT(book_id,chapter,verse,translation) DO UPDATE SET text=excluded.text",
        verse.bookId,
        verse.chapter,
        verse.verse,
        verse.text,
      );
  }
});
if (command === "seed") {
  if (env.APP_ENV === "production")
    throw new Error(
      "Demo data is disabled in production. Set APP_ENV=development explicitly for local use.",
    );
  seedDatabase(db);
  console.log("Development sample accounts and reflections are ready.");
} else if (command === "migrate")
  console.log("SQLite migrations are up to date.");
else throw new Error("Use: npm run db:migrate or npm run db:seed");
db.close();
