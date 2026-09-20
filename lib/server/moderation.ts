/** Server-only configuration. Add rules here; do not ship this list to the browser. */
const rules: {
  id: string;
  phrase: string;
  outcome: "WARN" | "REVIEW" | "BLOCK";
}[] = [
  { id: "slur-01", phrase: "nigger", outcome: "BLOCK" },
  { id: "slur-02", phrase: "faggot", outcome: "BLOCK" },
  { id: "targeted-harm", phrase: "kill yourself", outcome: "BLOCK" },
  { id: "targeted-threat", phrase: "i will kill you", outcome: "BLOCK" },
  { id: "targeted-contempt", phrase: "you are worthless", outcome: "BLOCK" },
  { id: "unsafe-context", phrase: "suicide", outcome: "REVIEW" },
  { id: "tone-insult", phrase: "idiot", outcome: "WARN" },
];
export type ModerationOutcome = "ALLOW" | "WARN" | "REVIEW" | "BLOCK";
export interface ModerationResult {
  outcome: ModerationOutcome;
  ruleId: string;
  message: string;
}
export function moderateText(text: string): ModerationResult {
  const normalized = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(
      /[013457@$]/g,
      (char) =>
        ({
          "0": "o",
          "1": "i",
          "3": "e",
          "4": "a",
          "5": "s",
          "7": "t",
          "@": "a",
          $: "s",
        })[char]!,
    );
  const words = normalized.replace(/[^a-z]+/g, " ").trim();
  for (const outcome of ["BLOCK", "REVIEW", "WARN"] as const) {
    for (const rule of rules.filter((item) => item.outcome === outcome)) {
      const separated = new RegExp(
        `(^|[^a-z])${rule.phrase
          .replace(/[^a-z]/g, "")
          .split("")
          .join("[^a-z]*")}(?![a-z])`,
      );
      const exactWord = new RegExp(`(^| )${rule.phrase}( |$)`).test(words);
      if (exactWord || (outcome === "BLOCK" && separated.test(normalized))) {
        return {
          outcome,
          ruleId: rule.id,
          message:
            outcome === "BLOCK"
              ? "Please revise this wording so it supports a respectful conversation."
              : outcome === "REVIEW"
                ? "Saved for a thoughtful review before it is shared."
                : "Saved. Consider gentler wording to keep this a welcoming space.",
        };
      }
    }
  }
  return { outcome: "ALLOW", ruleId: "clear", message: "Reflection saved." };
}

/** Plain text is intentional. React text interpolation escapes all HTML at render time. */
export function normalizeText(text: string) {
  return text
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}
