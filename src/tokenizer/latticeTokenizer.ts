import { DictionaryService } from "../dictionary/DictionaryService";
import { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { maxHskLevel } from "../dictionary/hskOverlay";
import { Trie } from "./Trie";
import { Token } from "./tokenizerTypes";

interface Edge {
  from: number;
  to: number;
  surface: string;
  candidates: DictionaryEntry[];
  cost: number;
}

export interface LatticeScoringContext {
  /** Surfaces with a stored WordRecord (any status), boosts cohesion. */
  hasRecord(surface: string): boolean;
  /** Returns user-known status weight. Higher = prefer this surface. */
  knownBoost(surface: string): number;
}

/**
 * Dictionary-aware lattice tokenizer for a CJK-only span.
 *
 * Scoring: minimize sum of edge costs along the path.
 *   - Each in-dictionary edge has base cost 1.
 *   - Multi-char dictionary words get a length bonus (cost - (len-1)*0.6).
 *   - HSK words get a small bonus.
 *   - Surfaces with user records or known status get a stronger bonus.
 *   - Single-character non-dictionary edges have a high cost so they only
 *     win when nothing else can.
 */
export function tokenizeLatticeSpan(
  cjkText: string,
  spanStart: number,
  dict: DictionaryService,
  trie: Trie,
  ctx: LatticeScoringContext
): Token[] {
  const n = cjkText.length;
  if (n === 0) return [];

  const edges: Edge[][] = Array.from({ length: n + 1 }, () => []);

  for (let i = 0; i < n; i++) {
    const ends = trie.matchesFrom(cjkText, i);
    if (ends.length === 0) {
      const surface = cjkText[i];
      edges[i].push({
        from: i,
        to: i + 1,
        surface,
        candidates: dict.lookup(surface),
        cost: 4.0,
      });
    } else {
      for (const end of ends) {
        const surface = cjkText.slice(i, end);
        const candidates = dict.lookup(surface);
        edges[i].push({
          from: i,
          to: end,
          surface,
          candidates,
          cost: edgeCost(surface, candidates, ctx),
        });
      }
      // Also allow single-char fallback if no single-char match yet (for robustness).
      if (!ends.includes(i + 1)) {
        const surface = cjkText[i];
        edges[i].push({
          from: i,
          to: i + 1,
          surface,
          candidates: dict.lookup(surface),
          cost: 4.0,
        });
      }
    }
  }

  // Viterbi / shortest-path on the DAG.
  const dist = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<Edge | null>(n + 1).fill(null);
  dist[0] = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(dist[i])) continue;
    for (const e of edges[i]) {
      const cand = dist[i] + e.cost;
      if (cand < dist[e.to]) {
        dist[e.to] = cand;
        prev[e.to] = e;
      }
    }
  }

  const path: Edge[] = [];
  let cur = n;
  while (cur > 0 && prev[cur]) {
    const e = prev[cur]!;
    path.push(e);
    cur = e.from;
  }
  path.reverse();

  return path.map<Token>((e) => {
    const selected = pickSelected(e.candidates);
    return {
      start: spanStart + e.from,
      end: spanStart + e.to,
      surface: e.surface,
      isWord: e.candidates.length > 0 || e.surface.length > 0,
      candidates: e.candidates,
      selected,
      confidence: confidenceOf(e),
    };
  });
}

function edgeCost(
  surface: string,
  candidates: DictionaryEntry[],
  ctx: LatticeScoringContext
): number {
  let cost = 1.0;
  if (candidates.length === 0) {
    return surface.length === 1 ? 4.0 : 3.5;
  }
  cost -= (surface.length - 1) * 0.6;
  const hskTop = maxHskLevel(candidates[0]?.hsk?.levels ?? []);
  if (hskTop > 0 && hskTop <= 3) cost -= 0.3;
  else if (hskTop > 0) cost -= 0.1;
  if (ctx.hasRecord(surface)) cost -= 0.4;
  cost -= ctx.knownBoost(surface);
  if (candidates.length > 3) cost += 0.15; // ambiguity penalty
  return Math.max(cost, -2.0);
}

function pickSelected(candidates: DictionaryEntry[]): DictionaryEntry | undefined {
  if (candidates.length === 0) return undefined;
  // Prefer HSK-tagged, otherwise the first.
  const hsk = candidates.find((c) => c.hsk && c.hsk.levels.length > 0);
  return hsk ?? candidates[0];
}

function confidenceOf(e: Edge): number {
  if (e.candidates.length === 0) return 0.3;
  if (e.candidates.length === 1) return 0.95;
  return Math.max(0.4, 1 - 0.15 * (e.candidates.length - 1));
}
