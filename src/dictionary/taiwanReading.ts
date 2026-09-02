import { numbersToToneMarks } from "./normalizeChinese";

/**
 * CC-CEDICT records a Taiwan-specific reading as a trailing gloss on the
 * entry, e.g. 垃圾 → /trash/…/Taiwan pr. [le4 se4]/. There is no separate
 * field for it, so the reading is parsed back out of `definitions[]`.
 *
 * Two bracket layouts occur in the shipped data — spaced (`[le4 se4]`) and
 * unspaced (`[xia4hai2]`) — so a syllable break is re-inserted after each
 * tone digit before conversion.
 *
 * The bracket is required. One entry (夹) carries a prose "Taiwan pr. used
 * in …" note with no reading of its own; demanding `[` skips it rather than
 * extracting nonsense.
 *
 * `also pr.` is deliberately ignored — it flags a general alternate reading,
 * not a regional one.
 */
const TAIWAN_PR = /^Taiwan pr\.\s*\[([^\]]+)\]/;

export function extractTaiwanReading(definitions: string[] | undefined): string | undefined {
  // The vault-side dictionary file is user-supplied and only validated for
  // `simplified` and `pinyin`, so a hand-edited entry can reach here with no
  // definitions at all. Never throw during dictionary load.
  if (!Array.isArray(definitions)) return undefined;
  for (const d of definitions) {
    if (typeof d !== "string") continue;
    // Cheap guard first: this runs over every definition of every entry
    // in a ~125k-entry dictionary at load time.
    if (d.charCodeAt(0) !== 84 /* T */ || !d.startsWith("Taiwan pr.")) continue;
    const m = TAIWAN_PR.exec(d);
    if (!m) continue;
    const spaced = m[1].replace(/([1-5])(?=[a-zA-ZüÜ])/g, "$1 ");
    const reading = numbersToToneMarks(spaced).trim();
    if (reading) return reading;
  }
  return undefined;
}
