import { DictionaryService } from "../dictionary/DictionaryService";
import { findCjkSpans } from "../dictionary/normalizeChinese";
import { Trie } from "./Trie";
import { tokenizeLatticeSpan, LatticeScoringContext } from "./latticeTokenizer";
import { Token, TokenizerOverride } from "./tokenizerTypes";
import { CciSettings } from "../settings/types";

export interface TokenizationCacheEntry {
  fileVersion: number;
  rangeStart: number;
  rangeEnd: number;
  tokens: Token[];
}

export class TokenizerService {
  private trie: Trie | null = null;
  private overrides = new Map<string, TokenizerOverride>();
  private cache = new Map<string, TokenizationCacheEntry>();

  constructor(
    private dict: DictionaryService,
    private scoringCtx: LatticeScoringContext,
    private settings: () => CciSettings
  ) {}

  setOverrides(overrides: TokenizerOverride[]): void {
    this.overrides.clear();
    for (const o of overrides) this.overrides.set(o.surface, o);
    this.invalidate();
  }

  invalidate(): void {
    this.cache.clear();
    this.trie = null;
  }

  private async ensureTrie(): Promise<Trie> {
    if (this.trie) return this.trie;
    await this.dict.ensureLoaded();
    const t = new Trie();
    for (const s of this.dict.surfaces()) t.insert(s);
    // Include trie entries for merge overrides.
    for (const o of this.overrides.values()) {
      if (o.mergeAs) t.insert(o.mergeAs);
    }
    this.trie = t;
    return t;
  }

  async tokenize(text: string): Promise<Token[]> {
    const engine = this.settings().tokenizerEngine;
    if (engine === "intl-segmenter") return this.tokenizeIntl(text);
    return this.tokenizeLattice(text);
  }

  private async tokenizeLattice(text: string): Promise<Token[]> {
    const trie = await this.ensureTrie();
    const out: Token[] = [];
    const spans = findCjkSpans(text);
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) {
        out.push({
          start: cursor,
          end: span.start,
          surface: text.slice(cursor, span.start),
          isWord: false,
          candidates: [],
          confidence: 1,
        });
      }
      const cjkTokens = tokenizeLatticeSpan(span.text, span.start, this.dict, trie, this.scoringCtx);
      out.push(...this.applyOverrides(cjkTokens, text));
      cursor = span.end;
    }
    if (cursor < text.length) {
      out.push({
        start: cursor,
        end: text.length,
        surface: text.slice(cursor),
        isWord: false,
        candidates: [],
        confidence: 1,
      });
    }
    return out;
  }

  private async tokenizeIntl(text: string): Promise<Token[]> {
    // @ts-ignore — Intl.Segmenter exists at runtime in modern browsers/Obsidian.
    const seg = new Intl.Segmenter("zh", { granularity: "word" });
    const out: Token[] = [];
    // @ts-ignore
    for (const s of seg.segment(text) as Iterable<{ segment: string; index: number; isWordLike?: boolean }>) {
      const start = s.index;
      const surface = s.segment;
      const end = start + surface.length;
      const candidates = this.dict.lookup(surface);
      out.push({
        start,
        end,
        surface,
        isWord: !!s.isWordLike,
        candidates,
        selected: candidates[0],
        confidence: candidates.length === 1 ? 0.95 : candidates.length > 1 ? 0.6 : 0.3,
      });
    }
    return out;
  }

  private applyOverrides(tokens: Token[], fullText: string): Token[] {
    if (this.overrides.size === 0) return tokens;
    const out: Token[] = [];
    for (const t of tokens) {
      const o = this.overrides.get(t.surface);
      if (!o) {
        out.push(t);
        continue;
      }
      if (o.ignore) {
        out.push({ ...t, isWord: t.isWord });
        continue;
      }
      if (o.splitInto && o.splitInto.length > 0) {
        let cursor = t.start;
        for (const piece of o.splitInto) {
          const end = cursor + piece.length;
          const cands = this.dict.lookup(piece);
          out.push({
            start: cursor,
            end,
            surface: piece,
            isWord: true,
            candidates: cands,
            selected: cands[0],
            confidence: 0.9,
          });
          cursor = end;
        }
        continue;
      }
      out.push(t);
    }
    return out;
  }
}
