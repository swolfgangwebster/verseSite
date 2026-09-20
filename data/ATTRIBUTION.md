# World English Bible

`bible-web.json` contains the World English Bible (`engwebp`) from the publisher’s authorized [verse-per-line export](https://ebible.org/Scriptures/engwebp_vpl.zip). The translation is dedicated to the **public domain**, as stated on [eBible.org’s translation and licensing page](https://ebible.org/find/details.php?id=engwebp). The name “World English Bible” is a trademark identifying faithful copies; do not apply it to altered Scripture text.

This edition includes 66 books, 1,189 chapters, and 31,103 numbered verse records. Its canon omits the Deuterocanon/Apocrypha. This is a dataset choice, not an exclusion of readers from any tradition. Additional authorized editions can be added through `BibleTextProvider`.

The importer preserves every verse’s Unicode text exactly as supplied in the publisher’s UTF-8 VPL export. Book identifiers are mapped to canonical internal identifiers; Scripture wording is not rewritten. Chapter and verse bounds are derived from the actual export. A few numbered records intentionally have empty text in this edition; the reading UI identifies those without inventing substitute verses. The publisher’s numbering need not match another translation’s numbering.

The JSON includes the source URL, translation, license, and SHA-256 digest of the original decoded VPL source. Original download intermediates are ignored by Git. The packaged JSON is the distributable dataset and works offline.

Refresh from the publisher with `npm run bible:import`, then restart the server to refresh its read cache. To refresh the optional SQL mirror too, run `npm run db:migrate`. Offline reimport: `npm run bible:import -- --source path/to/engwebp_vpl.zip` (or the authorized `.txt` export).
