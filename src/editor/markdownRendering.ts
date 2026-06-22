import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { setIcon, TFile } from "obsidian";
import type CciPlugin from "../main";
import { cciRedecorateEffect } from "./chineseDecorations";
import { computeExcludedRanges, isRangeExcluded } from "./markdownExclusionRanges";
import { findHighlightSpans, resolveHighlightPalette, type HighlightSpan } from "./highlightPalette";

/**
 * Hide markdown syntax characters and turn links into clickable widgets
 * inside the Chinese reading view. Only emits decorations in non-edit
 * modes; edit mode shows raw syntax so the cursor stays predictable.
 *
 * Coexists with `buildChineseDecorations`. Each plugin owns its own
 * range set and CM6 merges them.
 */
export function buildMarkdownRendering(plugin: CciPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      lastText = "";
      lastExclusions: ReturnType<typeof computeExcludedRanges> = [];

      constructor(view: EditorView) {
        this.rememberDoc(view);
        this.decorations = this.build(view, this.lastText, this.lastExclusions);
      }

      update(update: ViewUpdate) {
        const redecorate = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(cciRedecorateEffect))
        );
        if (update.docChanged) this.rememberDoc(update.view);
        if (update.docChanged || update.viewportChanged || redecorate) {
          this.decorations = this.build(update.view, this.lastText, this.lastExclusions);
        }
      }

      build(
        view: EditorView,
        text: string,
        excluded: ReturnType<typeof computeExcludedRanges>
      ): DecorationSet {
        // Edit mode: leave raw syntax visible.
        if (plugin.activeViewMode() === "edit") return Decoration.none;

        const tree = syntaxTree(view.state);

        // Collect decorations into an array first so we can sort by
        // start position before handing them to RangeSetBuilder, which
        // requires sorted input.
        const items: Array<{ from: number; to: number; deco: Decoration }> = [];
        const lineDecos: Array<{ from: number; to: number; deco: Decoration }> = [];

        // Resolve the Highlightr palette once per build so `<mark class="hltr-…">`
        // class names map to colors (inline `<mark style>` is self-describing).
        const palette = resolveHighlightPalette(plugin.app, plugin.settings);
        // Highlight spans computed once over the whole doc, but emitted only for
        // those fully inside a visible range — a ViewPlugin must NOT provide
        // `replace`/layout decorations (the hidden delimiters) off-screen or CM6
        // mis-measures the viewport and duplicates lines.
        const highlightSpans = findHighlightSpans(text, palette);
        // In ruby display modes the word is replaced by a widget; a content
        // mark over that same range overlaps the widget and destabilizes the
        // first paint (duplicated line). There, only hide the delimiters and let
        // `chineseDecorations` tint the characters. In "none" mode we still emit
        // the content mark so non-word text inside a highlight is tinted too.
        const dm = plugin.settings.defaultDisplayMode;
        const tintContent = dm !== "two-line" && dm !== "three-line";

        for (const { from, to } of view.visibleRanges) {
          tree.iterate({
            from,
            to,
            enter: (node: SyntaxNodeRef) => {
              this.handleNode(node, text, items, lineDecos);
            },
          });

          // Regex pass for wikilinks and embeds (lang-markdown does
          // not produce nodes for these). Run embed first so its `!`
          // does not get stranded as a stray character.
          const slice = text.slice(from, to);
          this.scanEmbeds(slice, from, excluded, items);
          this.scanWikilinks(slice, from, excluded, items);

          // Horizontal rule lines: lang-markdown does not always emit
          // `HorizontalRule`, so detect `---` / `***` / `___` lines
          // directly.
          this.scanHr(slice, from, items);

          // Things-theme style task checkboxes (`- [c]`). lang-markdown
          // only parses standard GFM `[ ]` / `[x]` so we scan for the
          // full alphabet of characters the user supports.
          this.scanTasks(slice, from, excluded, items);

          // Highlights (`==…==` and Highlightr `<mark …>`) fully inside this
          // visible range.
          this.emitHighlights(highlightSpans, from, to, excluded, items, tintContent);
        }

        items.sort((a, b) => (a.from - b.from) || (a.to - b.to));

        const builder = new RangeSetBuilder<Decoration>();
        // Line decorations have to be added in document order alongside
        // ranges. We attach them by walking lines visible to the view.
        // Simpler: add line decorations through a second builder pass —
        // but a single sorted pass works if line ranges are encoded
        // with start === end at line-start. Combine and re-sort.
        for (const it of lineDecos) items.push(it);
        items.sort((a, b) => (a.from - b.from) || (a.to - b.to));

        for (const { from, to, deco } of items) {
          builder.add(from, to, deco);
        }
        return builder.finish();
      }

      rememberDoc(view: EditorView): void {
        this.lastText = view.state.doc.toString();
        this.lastExclusions = computeExcludedRanges(this.lastText);
      }

      handleNode(
        node: SyntaxNodeRef,
        text: string,
        items: Array<{ from: number; to: number; deco: Decoration }>,
        lineDecos: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        const name = node.name;

        // HeaderMark: the `#` plus the trailing space.
        if (name === "HeaderMark") {
          // Include trailing whitespace so the visible text starts at
          // the heading content.
          let end = node.to;
          while (end < text.length && /[ \t]/.test(text[end])) end++;
          items.push({ from: node.from, to: end, deco: HIDE });
          return;
        }

        // QuoteMark: `>` plus following space. Mark the block-quote
        // line so CSS can show a vertical bar + indent.
        if (name === "QuoteMark") {
          let end = node.to;
          while (end < text.length && /[ \t]/.test(text[end])) end++;
          items.push({ from: node.from, to: end, deco: HIDE });
          const lineStart = lineStartAt(text, node.from);
          lineDecos.push({
            from: lineStart,
            to: lineStart,
            deco: QUOTE_LINE,
          });
          return;
        }

        if (name === "EmphasisMark") {
          items.push({ from: node.from, to: node.to, deco: HIDE });
          return;
        }

        if (name === "StrikethroughMark") {
          items.push({ from: node.from, to: node.to, deco: HIDE });
          return;
        }

        if (name === "ListMark") {
          // Unordered if the marker is one char of -, *, +. Ordered if
          // it contains a digit. Hide unordered + replace with bullet;
          // leave ordered numbers alone. Skip the bullet entirely when
          // the line is a task (`- [c] …`) — the checkbox widget
          // emitted by scanTasks() will replace the bullet too, so the
          // checkbox sits flush like in the Things theme.
          const raw = text.slice(node.from, node.to);
          if (!/^[-*+]$/.test(raw)) return;
          if (isTaskLineAt(text, node.to)) return;
          items.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new BulletWidget() }),
          });
          return;
        }

        if (name === "CodeMark") {
          // Only inline backticks should be hidden — fenced ``` marks
          // are not enclosed in inline-code spans, they belong to
          // FencedCode. Lang-markdown emits CodeMark for both. Inline
          // backticks are always exactly one or two chars.
          const len = node.to - node.from;
          if (len <= 2) {
            items.push({ from: node.from, to: node.to, deco: HIDE });
          }
          return;
        }

        if (name === "HorizontalRule") {
          items.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
          return;
        }

        if (name === "Link") {
          this.handleLink(node, text, items);
          return;
        }

        if (name === "Image") {
          // Inline markdown image `![alt](url)`. Replace with an img
          // widget. URL extraction uses simple regex; if it fails leave
          // the syntax raw rather than breaking the doc.
          const raw = text.slice(node.from, node.to);
          const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(raw);
          if (!m) return;
          items.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({
              widget: new ImgWidget(m[1]),
            }),
          });
          return;
        }
      }

      handleLink(
        node: SyntaxNodeRef,
        text: string,
        items: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        // Layout: `[label](url)`. Hide the opening `[`, the closing
        // `]`, and the `(url)` chunk, leaving the label visible and
        // marked with `cci-md-link` (click handler runs from the
        // EditorView.domEventHandlers below).
        const raw = text.slice(node.from, node.to);
        // Find the `](` boundary; the URL part may contain spaces only
        // when wrapped in `<...>` per CM, ignore that edge case.
        const closeBracket = raw.indexOf("](");
        if (closeBracket === -1) return;
        const urlEnd = raw.lastIndexOf(")");
        if (urlEnd === -1 || urlEnd <= closeBracket + 1) return;

        const labelStart = node.from + 1;
        const labelEnd = node.from + closeBracket;
        const urlOpen = node.from + closeBracket;
        const urlClose = node.from + urlEnd + 1;
        const url = raw.slice(closeBracket + 2, urlEnd).trim();

        items.push({ from: node.from, to: node.from + 1, deco: HIDE });
        items.push({
          from: labelStart,
          to: labelEnd,
          deco: Decoration.mark({
            class: "cci-md-link",
            attributes: { "data-cci-href": url },
          }),
        });
        items.push({ from: urlOpen, to: urlClose, deco: HIDE });
      }

      scanWikilinks(
        slice: string,
        offset: number,
        excluded: ReturnType<typeof computeExcludedRanges>,
        items: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        const re = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice))) {
          const start = offset + m.index;
          const end = start + m[0].length;
          // Skip embeds — they'll have been picked up by scanEmbeds and
          // start with a `!` immediately before the match.
          if (start > 0 && slice.charAt(m.index - 1) === "!") continue;
          if (isRangeExcluded(excluded, start, end)) continue;
          const target = m[1].trim();
          const alias = m[2]?.trim();
          items.push({
            from: start,
            to: end,
            deco: Decoration.replace({
              widget: new WikilinkWidget(plugin, target, alias),
            }),
          });
        }
      }

      scanEmbeds(
        slice: string,
        offset: number,
        excluded: ReturnType<typeof computeExcludedRanges>,
        items: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        const re = /!\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice))) {
          const start = offset + m.index;
          const end = start + m[0].length;
          if (isRangeExcluded(excluded, start, end)) continue;
          const target = m[1].trim();
          items.push({
            from: start,
            to: end,
            deco: Decoration.replace({
              widget: new EmbedWidget(plugin, target),
            }),
          });
        }
      }

      scanTasks(
        slice: string,
        offset: number,
        excluded: ReturnType<typeof computeExcludedRanges>,
        items: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        // Match `- [c]` / `* [c]` / `+ [c]` at line start. Replace the
        // whole `bullet + space + [c] + space` chunk with just the
        // checkbox widget so the line looks like the Things theme:
        // icon flush at the indent, no leading bullet. The leading
        // whitespace (`(\s{0,3})`) is preserved to keep nested indent.
        const re = /(^|\n)(\s{0,3})([-*+])([ \t]+)\[(.)\][ \t]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice))) {
          const matchStart = offset + m.index;
          if (isRangeExcluded(excluded, matchStart, matchStart + m[0].length)) {
            continue;
          }
          const leadLen = m[1].length + m[2].length; // newline + indent
          const restLen = m[3].length + m[4].length + 3 /* [c] */ + 1 /* trailing space */;
          const from = matchStart + leadLen;
          const to = from + restLen;
          const char = m[5];
          items.push({
            from,
            to,
            deco: Decoration.replace({ widget: new CheckboxWidget(char) }),
          });
        }
      }

      emitHighlights(
        spans: HighlightSpan[],
        rangeFrom: number,
        rangeTo: number,
        excluded: ReturnType<typeof computeExcludedRanges>,
        items: Array<{ from: number; to: number; deco: Decoration }>,
        tintContent: boolean
      ): void {
        for (const span of spans) {
          // Only spans fully within the visible range (no off-screen replaces).
          if (span.openFrom < rangeFrom || span.closeTo > rangeTo) continue;
          // Skip when the content sits in an excluded context (code, math…).
          if (isRangeExcluded(excluded, span.contentFrom, span.contentTo)) continue;
          // Always hide the delimiters / `<mark>` tags.
          items.push({ from: span.openFrom, to: span.contentFrom, deco: HIDE });
          items.push({ from: span.contentTo, to: span.closeTo, deco: HIDE });
          // The content tint is emitted only in non-ruby modes (see build()).
          if (!tintContent) continue;
          const deco = span.color
            ? Decoration.mark({
                class: "cci-md-highlight cci-md-colored",
                attributes: { style: `background-color:${span.color};` },
              })
            : Decoration.mark({ class: "cci-md-highlight" });
          items.push({ from: span.contentFrom, to: span.contentTo, deco });
        }
      }

      scanHr(
        slice: string,
        offset: number,
        items: Array<{ from: number; to: number; deco: Decoration }>
      ): void {
        const re = /(^|\n)(\s{0,3})(?:-{3,}|\*{3,}|_{3,})[ \t]*(?=\n|$)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice))) {
          // The match begins with the preceding newline (if any). The
          // HR characters start right after.
          const lead = m[1].length + m[2].length;
          const start = offset + m.index + lead;
          const end = start + (m[0].length - lead);
          items.push({
            from: start,
            to: end,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

const HIDE = Decoration.replace({});
const QUOTE_LINE = Decoration.line({ class: "cci-md-quote-line" });

function lineStartAt(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && text[i - 1] !== "\n") i--;
  return i;
}

/**
 * After a ListMark `-`, return true if the rest of the line opens with
 * a task marker `[c] `. Used so the bullet pass can defer to the task
 * pass and avoid emitting overlapping decorations on the same range.
 */
function isTaskLineAt(text: string, posAfterBullet: number): boolean {
  let i = posAfterBullet;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return (
    text[i] === "[" &&
    i + 2 < text.length &&
    text[i + 2] === "]" &&
    (text[i + 3] === " " || text[i + 3] === "\t")
  );
}

const TASK_ICON_MAP: Record<string, string> = {
  " ": "square",
  "/": "square-dashed",
  x: "check-square-2",
  X: "check-square-2",
  "-": "square-x",
  ">": "arrow-right-circle",
  "<": "calendar-clock",
  "?": "help-circle",
  "!": "alert-circle",
  "*": "star",
  '"': "quote",
  l: "map-pin",
  b: "bookmark",
  i: "info",
  S: "piggy-bank",
  I: "lightbulb",
  p: "thumbs-up",
  c: "thumbs-down",
  f: "flame",
  k: "key",
  w: "trophy",
  u: "trending-up",
  d: "trending-down",
  D: "git-pull-request-draft",
  P: "git-pull-request-arrow",
  M: "git-merge",
};

class CheckboxWidget extends WidgetType {
  constructor(private char: string) {
    super();
  }
  toDOM(): HTMLElement {
    const el = activeDocument.createElement("span");
    const icon = TASK_ICON_MAP[this.char] ?? "square";
    el.className = `cci-md-task cci-md-task-${safeClassChar(this.char)}`;
    if (this.char === "x" || this.char === "X") el.classList.add("is-done");
    if (this.char === "-") el.classList.add("is-cancel");
    el.setAttribute("data-cci-task", this.char);
    el.setAttribute("title", `Task: [${this.char}]`);
    try {
      setIcon(el, icon);
    } catch {
      el.textContent = `[${this.char}]`;
    }
    return el;
  }
  eq(other: CheckboxWidget): boolean {
    return other.char === this.char;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function safeClassChar(c: string): string {
  return /^[A-Za-z]$/.test(c) ? c : `c${c.charCodeAt(0)}`;
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = activeDocument.createElement("span");
    el.className = "cci-md-bullet";
    el.textContent = "•";
    return el;
  }
  eq(): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = activeDocument.createElement("hr");
    el.className = "cci-md-hr";
    return el;
  }
  eq(): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class WikilinkWidget extends WidgetType {
  constructor(
    private plugin: CciPlugin,
    private target: string,
    private alias?: string
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const el = activeDocument.createElement("span");
    el.className = "cci-md-wikilink";
    el.textContent = this.alias || this.target;
    el.setAttribute("title", `Open: ${this.target}`);
    attachOpenInChineseView(el, this.plugin, this.target);
    return el;
  }
  eq(other: WikilinkWidget): boolean {
    return other.target === this.target && other.alias === this.alias;
  }
  ignoreEvent(): boolean {
    // True = editor stays out, widget's own listeners handle the click.
    return true;
  }
}

class EmbedWidget extends WidgetType {
  constructor(private plugin: CciPlugin, private target: string) {
    super();
  }
  toDOM(): HTMLElement {
    const file = resolveLinkpath(this.plugin, this.target);
    // Image / video / pdf — render via vault resource URL.
    if (file && isImageFile(file)) {
      const img = activeDocument.createElement("img");
      img.className = "cci-md-embed-img";
      img.src = this.plugin.app.vault.getResourcePath(file);
      img.alt = this.target;
      return img;
    }
    // Note embed: clickable card that opens the note in the Chinese
    // view. Avoids the cost (and scope) of inline embed rendering.
    const card = activeDocument.createElement("span");
    card.className = "cci-md-embed cci-md-embed-card";
    card.textContent = file ? file.basename : this.target;
    attachOpenInChineseView(card, this.plugin, this.target);
    return card;
  }
  eq(other: EmbedWidget): boolean {
    return other.target === this.target;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class ImgWidget extends WidgetType {
  constructor(private url: string) {
    super();
  }
  toDOM(): HTMLElement {
    const img = activeDocument.createElement("img");
    img.className = "cci-md-embed-img";
    img.src = this.url;
    img.alt = "";
    return img;
  }
  eq(other: ImgWidget): boolean {
    return other.url === this.url;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function resolveLinkpath(plugin: CciPlugin, target: string): TFile | null {
  const activeFile = plugin.app.workspace.getActiveFile();
  const sourcePath = activeFile?.path ?? "";
  const dest = plugin.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return dest ?? null;
}

function isImageFile(file: TFile): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.path);
}

function attachOpenInChineseView(
  el: HTMLElement,
  plugin: CciPlugin,
  target: string
): void {
  const handler = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    // Don't navigate while an interactive mode is active (format / mark-* /
    // select) — the tap is a tool action, not a link follow.
    if (plugin.isInteractiveMode()) return;
    const file = resolveLinkpath(plugin, target);
    if (file && file.extension === "md") {
      void plugin.openFileInChineseView(file);
    } else if (file) {
      // Non-markdown vault file — let Obsidian handle it (image
      // viewer, PDF, etc.).
      void plugin.app.workspace.openLinkText(target, "", false);
    }
  };
  el.addEventListener("mousedown", handler);
  el.addEventListener("touchstart", handler, { passive: false });
}

/**
 * EditorView extension that handles clicks on plain markdown link spans
 * (`cci-md-link`). External URLs open via Obsidian's preferred handler;
 * vault-relative paths reuse the Chinese-view open helper.
 */
export function markdownLinkClickHandler(plugin: CciPlugin) {
  return EditorView.domEventHandlers({
    mousedown: (ev) => {
      if (!(ev.target instanceof HTMLElement)) return false;
      const el = ev.target.closest(".cci-md-link");
      if (!el) return false;
      const href = el.getAttribute("data-cci-href");
      if (!href) return false;
      ev.preventDefault();
      ev.stopPropagation();
      // Suppress navigation during interactive modes (tap = tool action).
      if (plugin.isInteractiveMode()) return true;
      openHref(plugin, href);
      return true;
    },
  });
}

export function openHref(plugin: CciPlugin, href: string): void {
  // Defensive: never navigate while an interactive mode is active.
  if (plugin.isInteractiveMode()) return;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  // Treat anything else as a vault-relative link.
  const file = resolveLinkpath(plugin, href);
  if (file && file.extension === "md") {
    void plugin.openFileInChineseView(file);
    return;
  }
  void plugin.app.workspace.openLinkText(href, "", false);
}
