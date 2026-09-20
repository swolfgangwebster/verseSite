import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { BOOK_DEFINITIONS } from "../lib/bible-books";

const SOURCE = "https://ebible.org/Scriptures/engwebp_vpl.zip";
// Extract just the official verse-per-line text from a ZIP central directory.
function verseTextFromZip(zip: Buffer): string {
  let end = zip.length - 22;
  while (
    end >= Math.max(0, zip.length - 65558) &&
    zip.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  if (end < 0) throw new Error("Invalid publisher ZIP archive.");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid ZIP directory.");
    const method = zip.readUInt16LE(offset + 10),
      size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28),
      extraLength = zip.readUInt16LE(offset + 30),
      commentLength = zip.readUInt16LE(offset + 32);
    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (name === "engwebp_vpl.txt") {
      const local = zip.readUInt32LE(offset + 42);
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const compressed = zip.subarray(start, start + size);
      if (method !== 0 && method !== 8)
        throw new Error("Unsupported ZIP compression.");
      return (
        method === 8
          ? inflateRawSync(compressed, { maxOutputLength: 15_000_000 })
          : compressed
      ).toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("The publisher archive did not contain engwebp_vpl.txt.");
}
const sourceIndex = process.argv.indexOf("--source");
let text: string;
if (sourceIndex >= 0) {
  const file = process.argv[sourceIndex + 1];
  if (!file)
    throw new Error(
      "Supply an authorized VPL .txt or publisher .zip after --source.",
    );
  const bytes = readFileSync(file);
  text = file.endsWith(".zip")
    ? verseTextFromZip(bytes)
    : bytes.toString("utf8");
} else {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Publisher download failed (${response.status}).`);
  const zip = Buffer.from(await response.arrayBuffer());
  if (zip.length > 20_000_000) throw new Error("Unexpectedly large archive.");
  text = verseTextFromZip(zip);
}
const rows: { bookId: string; chapter: number; verse: number; text: string }[] =
  [];
const known = new Set<string>(BOOK_DEFINITIONS.map((b) => b[0]));
const unique = new Set<string>();
const publisherIds: Record<string, string> = {
  SOL: "SNG",
  EZE: "EZK",
  JOE: "JOL",
  NAH: "NAM",
  MAR: "MRK",
  JOH: "JHN",
  PHI: "PHP",
  JAM: "JAS",
  "1JO": "1JN",
  "2JO": "2JN",
  "3JO": "3JN",
};
for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = /^(\w{3}) (\d+):(\d+) (.*)$/.exec(line);
  if (!match)
    throw new Error(
      "Unexpected verse-per-line format; the existing dataset was not changed.",
    );
  const [, sourceId, chapter, verse, body] = match;
  const bookId = publisherIds[sourceId] || sourceId;
  if (!known.has(bookId))
    throw new Error("Unexpected publisher book identifier.");
  const key = `${bookId}:${chapter}:${verse}`;
  if (unique.has(key)) throw new Error(`Duplicate reference ${key}.`);
  unique.add(key);
  rows.push({
    bookId,
    chapter: Number(chapter),
    verse: Number(verse),
    text: body,
  });
}
const books = BOOK_DEFINITIONS.map(([id, name], i) => {
  const verses = rows.filter((v) => v.bookId === id);
  const chapterCount = Math.max(...verses.map((v) => v.chapter));
  const chapters = Array.from({ length: chapterCount }, (_, c) =>
    Math.max(...verses.filter((v) => v.chapter === c + 1).map((v) => v.verse)),
  );
  if (
    !chapterCount ||
    chapters.some((count) => !Number.isFinite(count) || count < 1)
  )
    throw new Error(`Incomplete book ${id}.`);
  return { id, name, order: i + 1, chapterCount, chapters };
});
if (books.length !== 66 || rows.length < 31000 || rows.length > 32000)
  throw new Error("Dataset completeness check failed.");
mkdirSync("data", { recursive: true });
writeFileSync(
  "data/bible-web.json",
  JSON.stringify({
    translation: "WEB",
    edition: "World English Bible (engwebp)",
    source: SOURCE,
    license: "Public domain",
    sourceSha256: createHash("sha256").update(text).digest("hex"),
    books,
    verses: rows,
  }),
);
console.log(
  `Imported ${rows.length.toLocaleString()} verses in ${books.length} books to data/bible-web.json. Scripture text preserved from the publisher export.`,
);
