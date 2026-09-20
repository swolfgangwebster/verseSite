import assert from "node:assert/strict";
import test from "node:test";
import {
  getBooks,
  getDailyVerse,
  getPassage,
  getSiteDate,
  parseReference,
} from "../lib/bible";

test("normalizes book aliases, spacing, case, punctuation and numbered books", () => {
  for (const ref of ["John 3:16", " jn. 3 : 16 ", "JOHN3:16", "JHN 3:16"])
    assert.equal(parseReference(ref).displayReference, "John 3:16");
  assert.equal(parseReference("psalm 23").displayReference, "Psalms 23");
  assert.equal(
    parseReference("II Timothy 1:7").displayReference,
    "2 Timothy 1:7",
  );
  assert.equal(
    parseReference("1Cor 13:4–7").displayReference,
    "1 Corinthians 13:4-7",
  );
  assert.equal(parseReference("Song of Songs 2:1").bookId, "SNG");
  assert.equal(
    parseReference("John 3:16-3:18").displayReference,
    "John 3:16-18",
  );
  assert.equal(parseReference("John 3:16-16").displayReference, "John 3:16");
});
test("models verses, ranges, cross-chapter ranges, chapters and books", () => {
  assert.equal(parseReference("John 3:16").targetType, "VERSE");
  const range = parseReference("John 3:16-4:2");
  assert.deepEqual(
    [
      range.startChapter,
      range.startVerse,
      range.endChapter,
      range.endVerse,
      range.targetType,
    ],
    [3, 16, 4, 2, "RANGE"],
  );
  assert.equal(getPassage(range).verses.length, 23);
  assert.equal(parseReference("Romans 8").targetType, "CHAPTER");
  assert.equal(parseReference("Psalms").targetType, "BOOK");
  assert.equal(parseReference("Psalms").endChapter, 150);
  assert.equal(getPassage("John 3-4").verses.length, 90);
});
test("rejects impossible, reversed, multi-book and ambiguous references", () => {
  for (const ref of [
    "John 0",
    "John 22",
    "John 3:0",
    "John 3:37",
    "John 3:18-16",
    "John 4:2-3:16",
    "Psalms 151",
    "John 3:16; Romans 8",
    "John 3:16-Romans 8:1",
    "John 3-4:2",
    "unknown 1:1",
    "",
    "1 John 6",
    "John 3:16-4:999",
  ])
    assert.throws(() => parseReference(ref), Error, ref);
});
test("complete authorized corpus includes every chapter in all 66 books and accurate text", () => {
  const books = getBooks();
  assert.equal(books.length, 66);
  assert.equal(
    books.reduce((sum, book) => sum + book.chapterCount, 0),
    1189,
  );
  let total = 0;
  for (const book of books) {
    const passage = getPassage(book.name);
    assert.ok(passage.available);
    assert.equal(
      new Set(passage.verses.map((v) => v.chapter)).size,
      book.chapterCount,
    );
    total += passage.verses.length;
  }
  assert.equal(total, 31103);
  assert.equal(
    getPassage("Genesis 1:1").verses[0].text,
    "In the beginning, God created the heavens and the earth.",
  );
  assert.match(
    getPassage("John 3:16").verses[0].text,
    /For God so loved the world/,
  );
  assert.equal(getPassage("Luke 17:36").verses[0].text, ""); // Publisher intentionally leaves this number unprinted.
});
test("chapter navigation crosses book boundaries without invalid references", () => {
  assert.equal(getPassage("Genesis 1").previousChapter, null);
  assert.equal(getPassage("Genesis 50").nextChapter, "Exodus 1");
  assert.equal(getPassage("John 1").previousChapter, "Luke 24");
  assert.equal(getPassage("Revelation 22").nextChapter, null);
});
test("daily passage uses configured calendar date including DST and honors curation", () => {
  assert.equal(
    getSiteDate(new Date("2026-03-08T04:59:00Z"), "America/New_York"),
    "2026-03-07",
  );
  assert.equal(
    getSiteDate(new Date("2026-03-08T07:01:00Z"), "America/New_York"),
    "2026-03-08",
  );
  const a = getDailyVerse(new Date("2026-09-09T04:01:00Z"));
  const b = getDailyVerse(new Date("2026-09-10T03:59:00Z"));
  assert.equal(a.date, b.date);
  assert.equal(a.target.displayReference, b.target.displayReference);
  const curated = getDailyVerse(
    new Date("2026-09-09T12:00:00Z"),
    "America/New_York",
    [{ date: "2026-09-09", reference: "Micah 6:8" }],
  );
  assert.equal(curated.source, "curated");
  assert.equal(curated.target.displayReference, "Micah 6:8");
  assert.throws(() => getSiteDate(new Date(), "Not/A_Timezone"));
});
