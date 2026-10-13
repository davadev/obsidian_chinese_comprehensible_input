/**
 * Browser-side half of scripts/render-screenshots.mjs. Bundled from the REAL source and run in headless Chromium; it is
 * NOT part of the plugin.
 *
 * It mounts the plugin's real toolbar and dialogs with fixture data (no AI call is made), next to the shipped styles.css,
 * then draws the numbered green callouts the other README screenshots use. Scene is chosen with ?scene=NAME.
 */
import { App } from "obsidian";
import { installObsidianDom } from "../../src/tests/__mocks__/obsidianDom";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import { ViewToolbar } from "../../src/view/ViewToolbar";
import { ExplainModal } from "../../src/ui/ExplainModal";
import { PhraseModal } from "../../src/ui/PhraseModal";
import { WhatsNewModal } from "../../src/ui/whatsNew/WhatsNewModal";
import { RELEASE_NOTES } from "../../src/ui/whatsNew/releaseNotes";
import { FULL } from "../../src/tests/explainFixture";

installObsidianDom();
// Obsidian provides these globals (pop-out window support); the plugin uses them.
(window as any).activeDocument = document;
(window as any).activeWindow = window;

type Rect = { left: number; top: number; width: number; height: number };
type Callout = { sel: string; n: number; text?: string; pad?: number; nth?: number; side?: "right" | "top" | "bottom" };
const scene = new URLSearchParams(location.search).get("scene") ?? "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
  for (let i = 0; i < 6; i++) await sleep(0);
};

function settings() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.ai.enabled = true;
  s.ai.provider = "openai";
  s.defaultDisplayMode = "three-line";
  return s;
}

const USAGE = { ts: 1, provider: "openai", model: "gpt-6-luna", inputTokens: 1200, cachedInputTokens: 0, outputTokens: 2100 };

function aiPlugin(extra: Record<string, unknown>) {
  const listeners = new Set<(e: unknown) => void>();
  const emit = () => listeners.forEach((l) => l(USAGE));
  const settingsObj = settings();
  const plugin: Record<string, any> = {
    settings: settingsObj,
    onAiUsage: (cb: (e: unknown) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit,
    ...extra,
  };
  return plugin;
}

function fakeApp(): any {
  const app: any = new App();
  app.vault = {
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (p: string) => ({ path: p }),
  };
  app.metadataCache = { getFileCache: () => null };
  app.workspace = { getLeaf: () => ({ setViewState: async () => {} }) };
  return app;
}

const btn = (r: ParentNode, text: string) => Array.from(r.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

async function mountToolbar(mode: "read" | "explain", pending: boolean, action: "explain" | "proofread" = "explain") {
  const stage = document.body.appendChild(document.createElement("div"));
  stage.className = "stage cci-reading-surface";
  const s = settings();
  s.phraseAction = action;
  let current = mode;
  const plugin: any = {
    settings: s,
    app: {},
    pendingCustomSurface: "",
    pendingFormatStart: null,
    pendingFormatStartSurface: null,
    pendingPhraseStart: pending ? 1 : null,
    pendingPhraseStartSurface: pending ? "学习" : null,
    aiConfigured: () => true,
    promptAiSetup: () => {},
    saveSettings: async () => {},
    activeViewMode: () => current,
    setActiveViewMode: (m: typeof mode) => void (current = m),
    offerReindexAfterScriptChange: () => {},
    computeNoteStats: async () => ({ total: 120, known: 66, partial: 20, unknown: 24, newCount: 10, topHsk: "4" }),
    currentNoteKey: () => "note.md",
    openStatsForNote: async () => {},
    openStatsView: async () => {},
    openGenerateStoryModal: () => {},
    openBatchMnemonicModal: () => {},
  };
  new ViewToolbar(plugin, stage, () => {}, () => "你好", () => {});
  await settle();
  return stage;
}

const SENTENCE = "我昨天去了商店买东西。";
const PHRASE_RESULT = {
  translation: "I went to the shop yesterday to buy things.",
  expresses: "Says what you did and why, in the order it happened.",
  register: "neutral, everyday",
  structure: "Subject + time + 去了 + place + purpose",
  breakdown: [
    { text: "我", pinyin: "wǒ", role: "subject", meaning: "I" },
    { text: "昨天", pinyin: "zuó tiān", role: "time word, before the verb", meaning: "yesterday" },
    { text: "去", pinyin: "qù", role: "main verb", meaning: "go" },
    { text: "了", pinyin: "le", role: "aspect particle: completed", meaning: "(completed action)" },
    { text: "商店", pinyin: "shāng diàn", role: "place the verb moves to", meaning: "shop" },
    { text: "买", pinyin: "mǎi", role: "second verb: the purpose", meaning: "buy" },
    { text: "东西", pinyin: "dōng xi", role: "object of 买", meaning: "things" },
  ],
  grammarPoints: [
    { point: "了 after the verb", explanation: "Marks the action as completed, not the past as such.", example: "我去了商店。" },
    { point: "Verbs in a row", explanation: "去 … 买 …: the second verb says why you went.", example: "" },
  ],
  typo: "",
  notes: [],
};

async function phraseScene(action: "explain" | "proofread", text: string, auto: boolean) {
  const plugin = aiPlugin({});
  plugin.settings.explain.maxPhraseChars = 150;
  plugin.phraseExplain = {
    check: async () => (plugin.emit(), { verdict: "ok", note: "", original: "", suggestion: "" }),
    explain: async () => (plugin.emit(), { result: PHRASE_RESULT, issues: [] }),
  };
  plugin.proofread = {
    proofread: async () => (
      plugin.emit(),
      {
        result: {
          corrections: [
            { original: "昨天去了商店买东西很多", replacement: "昨天去商店买了很多东西", why: "Put the amount before 东西 and 了 after the verb 买, not after 去." },
          ],
        },
        issues: [],
      }
    ),
  };
  const view = { replaceRange: () => true };
  const modal = new PhraseModal(fakeApp(), plugin as any, { text, raw: text, from: 0, to: text.length, view: view as any, hasMarkup: false }, action);
  modal.open();
  if (auto) {
    const root = modal.contentEl as HTMLElement;
    btn(root, action === "explain" ? "Explain" : "Proof read").click();
    await sleep(50);
    await settle();
  }
}

async function explainScene() {
  const plugin = aiPlugin({
    dictionary: {
      lookup: (s: string) =>
        s === "方便" ? [{ simplified: "方便", traditional: "方便", pinyin: "fāng biàn", definitions: ["convenient"], hsk: { source: "2.0", levels: ["3"] } }] : [],
      isTraditionalMarker: () => false,
    },
    vocab: { bySurface: () => undefined },
  });
  plugin.explain = { generate: async () => (plugin.emit(), { result: FULL, issues: [] }) };
  const modal = new ExplainModal(fakeApp(), plugin as any, "方便", "住在这里很方便。");
  modal.open();
  await sleep(50);
  await settle();
}

function whatsNewScene() {
  new WhatsNewModal(fakeApp(), [RELEASE_NOTES.find((n) => n.version === "0.9.0") as (typeof RELEASE_NOTES)[number]], () => {}).open();
}

/** Draw the dashed boxes and numbered circles (colours from scripts/annotate-screenshots.py). */
function callouts(items: Callout[], side: "right" | "top" | "bottom") {
  const report: { n: number; box: Rect; circle: { cx: number; cy: number } }[] = [];
  const layer = document.body.appendChild(document.createElement("div"));
  layer.className = "co-layer";
  const origin = document.documentElement.getBoundingClientRect();
  for (const it of items) {
    const all = it.text
      ? Array.from(document.querySelectorAll<HTMLElement>(it.sel)).filter((e) => (e.textContent ?? "").includes(it.text as string))
      : Array.from(document.querySelectorAll<HTMLElement>(it.sel));
    const el = all[it.nth ?? 0];
    if (!el) throw new Error(`callout ${it.n}: nothing matches ${it.sel}${it.text ? ` containing "${it.text}"` : ""}`);
    const r = el.getBoundingClientRect();
    const pad = it.pad ?? 2;
    const box = layer.appendChild(document.createElement("div"));
    box.className = "co-box";
    Object.assign(box.style, { left: `${r.left - origin.left - pad}px`, top: `${r.top - origin.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const c = layer.appendChild(document.createElement("div"));
    c.className = "co-circle";
    c.textContent = String(it.n);
    const where = it.side ?? side;
    const cx = where === "right" ? origin.width - 24 : r.left - origin.left + r.width / 2;
    const cy = where === "right" ? r.top - origin.top + r.height / 2 : where === "bottom" ? origin.height - 22 : 22;
    Object.assign(c.style, { left: `${cx - 13}px`, top: `${cy - 13}px` });
    report.push({
      n: it.n,
      box: { left: r.left - origin.left - pad, top: r.top - origin.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 },
      circle: { cx, cy },
    });
  }
  return report;
}

const TOOLBAR: Callout[] = [
  { sel: "[data-mode=edit]", n: 1 },
  { sel: "[data-mode=mark-known]", n: 2 },
  { sel: "[data-mode=mark-unknown]", n: 3 },
  { sel: "[data-mode=mark-partial]", n: 4 },
  { sel: "[data-mode=select-word]", n: 5 },
  { sel: ".cci-format-btn, [data-mode=format]", n: 6 },
  { sel: "[data-mode=explain]", n: 7 },
  { sel: ".cci-color-mode-btn", n: 8 },
  { sel: ".cci-overflow-btn-trigger", n: 9 },
  { sel: ".cci-note-stats-row", n: 10, side: "right", pad: 2 },
];

async function main() {
  document.body.classList.add("scene-" + scene);
  let items: Callout[] = [];
  let side: "right" | "top" | "bottom" = "right";
  switch (scene) {
    case "toolbar":
      await mountToolbar("read", false);
      items = TOOLBAR;
      side = "top";
      break;
    case "lightbulb":
      await mountToolbar("explain", true);
      items = [
        { sel: "[data-mode=explain]", n: 1 },
        { sel: ".cci-banner.is-explain > span", n: 2, side: "bottom" },
        { sel: ".cci-banner.is-explain button", n: 3, text: "Explain", side: "bottom" },
        { sel: ".cci-banner.is-explain button", n: 4, text: "Exit", side: "bottom" },
      ];
      side = "top";
      break;
    case "phrase-confirm":
      await phraseScene("explain", SENTENCE, false);
      items = [
        { sel: "blockquote", n: 1 },
        { sel: "p", n: 2, text: "of 150 characters" },
        { sel: "p", n: 3, text: "Estimated cost" },
        { sel: "button", n: 4, text: "Explain" },
      ];
      break;
    case "phrase-explain":
      await phraseScene("explain", SENTENCE, true);
      items = [
        { sel: "h2,h3,h4", n: 1, text: "Meaning" },
        { sel: "h2,h3,h4", n: 2, text: "Word by word" },
        { sel: "p", n: 3, text: "Cost on OpenAI" },
        { sel: "button", n: 4, text: "Save as note" },
      ];
      break;
    case "proofread":
      await phraseScene("proofread", "我昨天去了商店买东西很多。", true);
      items = [
        { sel: "button", n: 1, text: "Apply" },
        { sel: "button", n: 2, text: "Copy corrected text" },
      ];
      break;
    case "explain-word":
      await explainScene();
      items = [
        { sel: "h3,h4", n: 1, text: "When you need this word" },
        { sel: "h2,h3,h4", n: 2, text: "Watch out" },
        { sel: "h2,h3,h4", n: 3, text: "The characters" },
        { sel: "p", n: 4, text: "Cost on OpenAI" },
        { sel: "button", n: 5, text: "Save as note" },
      ];
      break;
    case "whatsnew":
      whatsNewScene();
      items = [
        { sel: ".cci-fig-toolbar", n: 1 },
        { sel: "button", n: 2, text: "Don't show again" },
      ];
      break;
    default:
      throw new Error(`unknown scene "${scene}"`);
  }
  await settle();
  // The stub's Modal has no Obsidian chrome classes; give each open dialog the ones the harness stylesheet dresses.
  document.querySelectorAll<HTMLElement>("body > div:not(.co-layer):not(.stage)").forEach((c) => {
    c.classList.add("modal-container");
    c.firstElementChild?.classList.add("modal");
  });
  const want = new URLSearchParams(location.search).get("callouts") !== "0";
  const report = want ? callouts(items, side) : [];
  document.documentElement.setAttribute("data-content-height", String(Math.ceil(document.body.getBoundingClientRect().height)));
  // render-screenshots.mjs checks this geometry (scripts/lib/calloutChecks.mjs) before it accepts the image.
  document.documentElement.setAttribute("data-callout-report", JSON.stringify(report));
}

main().catch((e) => {
  document.documentElement.setAttribute("data-error", String(e && (e as Error).stack ? (e as Error).stack : e));
});
