import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK_DEFINITIONS } from "./bible-books";

export interface BibleBook {
  id: string;
  name: string;
  order: number;
  chapters: number[];
  chapterCount: number;
}
export interface BibleVerse {
  bookId: string;
  chapter: number;
  verse: number;
  text: string;
}
export interface PassageTarget {
  bookId: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  targetType: "VERSE" | "RANGE" | "CHAPTER" | "BOOK";
  translationId: "WEB";
  displayReference: string;
}
export interface Passage {
  target: PassageTarget;
  verses: BibleVerse[];
  available: boolean;
  translation: { id: string; name: string; attribution: string };
  previousChapter: string | null;
  nextChapter: string | null;
}
export interface DailyVerseEntry {
  date: string;
  reference: string;
}
export interface BibleTextProvider {
  getBooks(): BibleBook[];
  getPassage(target: PassageTarget): Passage;
}
interface Dataset {
  books: BibleBook[];
  verses: BibleVerse[];
}
let dataset: Dataset | undefined;
function data(): Dataset {
  if (!dataset)
    dataset = JSON.parse(
      readFileSync(join(process.cwd(), "data", "bible-web.json"), "utf8"),
    ) as Dataset;
  return dataset;
}
export function getBooks() {
  return data().books;
}
export const listBooks = getBooks;
const normalizeAlias = (value: string) =>
  value.toLowerCase().replace(/[.\s]/g, "");
const aliases = new Map<string, string>();
for (const [id, name, alternatives] of BOOK_DEFINITIONS)
  for (const alias of [id, name, ...alternatives.split(" ")])
    aliases.set(normalizeAlias(alias), id);
export class BibleReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BibleReferenceError";
  }
}
export function parseReference(input: string): PassageTarget {
  if (typeof input !== "string" || input.length > 100)
    throw new BibleReferenceError(
      "Enter a Bible reference of no more than 100 characters.",
    );
  const reference = input
    .normalize("NFKC")
    .trim()
    .replace(/[–—−]/g, "-")
    .replace(/\s*([:-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(
      /^(III|II|I|First|Second|Third)\s+/i,
      (word) =>
        `${({ i: 1, ii: 2, iii: 3, first: 1, second: 2, third: 3 } as Record<string, number>)[word.trim().toLowerCase()]} `,
    );
  const match =
    /^((?:[1-3]\s*)?[a-zA-Z][a-zA-Z .]*?)(?:\s*(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?)?$/.exec(
      reference,
    );
  if (!match)
    throw new BibleReferenceError(
      "Try John 3:16, John 3:16-18, John 3:16-4:2, Romans 8, or Psalms.",
    );
  const id = aliases.get(normalizeAlias(match[1]));
  const book = getBooks().find((b) => b.id === id);
  if (!book)
    throw new BibleReferenceError(
      "That book name isn’t recognized. Try its full name, such as John or 1 Corinthians.",
    );
  const chapter = match[2] === undefined ? null : Number(match[2]);
  const verse = match[3] === undefined ? null : Number(match[3]);
  const end = match[4] === undefined ? null : Number(match[4]);
  const endVerseGiven = match[5] === undefined ? null : Number(match[5]);
  function validate(c: number, v?: number) {
    if (c < 1 || c > book!.chapterCount)
      throw new BibleReferenceError(
        `${book!.name} has ${book!.chapterCount} chapters. Choose a chapter from 1 to ${book!.chapterCount}.`,
      );
    if (v !== undefined && (v < 1 || v > book!.chapters[c - 1]))
      throw new BibleReferenceError(
        `${book!.name} ${c} has ${book!.chapters[c - 1]} verses. Choose a verse within that chapter.`,
      );
  }
  if (chapter === null)
    return {
      bookId: book.id,
      startChapter: 1,
      startVerse: 1,
      endChapter: book.chapterCount,
      endVerse: book.chapters[book.chapterCount - 1],
      targetType: "BOOK",
      translationId: "WEB",
      displayReference: book.name,
    };
  validate(chapter, verse ?? undefined);
  if (verse === null && endVerseGiven !== null)
    throw new BibleReferenceError(
      "For a range across chapters, include both starting and ending verses, such as John 3:1-4:2.",
    );
  const startVerse = verse ?? 1;
  const endChapter =
    end === null
      ? chapter
      : verse === null || endVerseGiven !== null
        ? end
        : chapter;
  const endVerse =
    end === null
      ? (verse ?? book.chapters[chapter - 1])
      : verse === null
        ? book.chapters[endChapter - 1]
        : (endVerseGiven ?? end);
  validate(endChapter, endVerse);
  if (endChapter < chapter || (endChapter === chapter && endVerse < startVerse))
    throw new BibleReferenceError(
      "The end of a passage must come after its beginning.",
    );
  const singleVerse =
    verse !== null && chapter === endChapter && startVerse === endVerse;
  const targetType = singleVerse ? "VERSE" : end !== null ? "RANGE" : "CHAPTER";
  const rangeSuffix =
    end === null || singleVerse
      ? ""
      : verse === null
        ? `-${endChapter}`
        : chapter === endChapter
          ? `-${endVerse}`
          : `-${endChapter}:${endVerse}`;
  const displayReference = `${book.name} ${chapter}${verse === null ? "" : `:${verse}`}${rangeSuffix}`;
  return {
    bookId: book.id,
    startChapter: chapter,
    startVerse,
    endChapter,
    endVerse,
    targetType,
    translationId: "WEB",
    displayReference,
  };
}
export class PackagedBibleTextProvider implements BibleTextProvider {
  getBooks() {
    return getBooks();
  }
  getPassage(target: PassageTarget): Passage {
    const book = getBooks().find((b) => b.id === target.bookId);
    if (!book)
      throw new BibleReferenceError("This Bible book isn’t available.");
    const verses = data().verses.filter(
      (v) =>
        v.bookId === target.bookId &&
        (v.chapter > target.startChapter ||
          (v.chapter === target.startChapter &&
            v.verse >= target.startVerse)) &&
        (v.chapter < target.endChapter ||
          (v.chapter === target.endChapter && v.verse <= target.endVerse)),
    );
    return {
      target,
      verses,
      available: verses.length > 0,
      translation: {
        id: "WEB",
        name: "World English Bible",
        attribution:
          "World English Bible (engwebp), public domain. Source: eBible.org.",
      },
      previousChapter:
        target.startChapter > 1
          ? `${book.name} ${target.startChapter - 1}`
          : book.order > 1
            ? `${getBooks()[book.order - 2].name} ${getBooks()[book.order - 2].chapterCount}`
            : null,
      nextChapter:
        target.endChapter < book.chapterCount
          ? `${book.name} ${target.endChapter + 1}`
          : book.order < getBooks().length
            ? `${getBooks()[book.order].name} 1`
            : null,
    };
  }
}
export const bibleProvider: BibleTextProvider = new PackagedBibleTextProvider();
export function getPassage(reference: string | PassageTarget) {
  return bibleProvider.getPassage(
    typeof reference === "string" ? parseReference(reference) : reference,
  );
}
export function getSiteDate(
  date = new Date(),
  timezone = "America/New_York",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}
export const DAILY_REFERENCES = [
  "Psalms 46:10",
  "Psalms 23:1-3",
  "John 3:16",
  "Proverbs 3:5-6",
  "Matthew 11:28-30",
  "Micah 6:8",
  "Philippians 4:6-7",
  "Romans 12:12",
  "Lamentations 3:22-23",
  "Isaiah 40:31",
  "John 15:9-12",
  "Psalms 139:14",
  "Matthew 5:9",
  "Colossians 3:12-14",
];
export function getDailyVerse(
  date = new Date(),
  timezone = "America/New_York",
  curated: DailyVerseEntry[] = [],
): Passage & { date: string; source: "curated" | "fallback" } {
  const siteDate = getSiteDate(date, timezone);
  const entry = curated.find((entry) => entry.date === siteDate);
  const index = Math.floor(Date.parse(`${siteDate}T00:00:00Z`) / 86400000);
  const reference =
    entry?.reference ||
    DAILY_REFERENCES[
      ((index % DAILY_REFERENCES.length) + DAILY_REFERENCES.length) %
        DAILY_REFERENCES.length
    ];
  return {
    ...getPassage(reference),
    date: siteDate,
    source: entry ? "curated" : "fallback",
  };
}
