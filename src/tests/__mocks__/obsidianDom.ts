/**
 * Obsidian patches a set of helpers onto the DOM (`createDiv`, `el.empty()`, `el.addClass()`...) and exposes a few as
 * globals (`createFragment`, `createDiv`...). Plugin code uses them everywhere, so any test that builds DOM needs the
 * same ones. They used to be re-stubbed by hand in individual tests; this is the one copy.
 *
 * Two entry points, because there are two kinds of test:
 *  - `installCreateFragmentStub()` for plain-Node tests that never build real DOM (SettingsTab definitions only call
 *    `createFragment(cb)` to hold a description), and
 *  - `installObsidianDom()` for anything with a real `document` (happy-dom in vitest, or the Chromium page that
 *    `npm run check:layout` drives, which imports this same file so the two cannot drift).
 *
 * Semantics follow the app: the GLOBAL form makes a DETACHED element, the METHOD form makes AND appends.
 */

export interface DomInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
  href?: string;
  placeholder?: string;
  parent?: Node;
  prepend?: boolean;
}
type ElInfo = string | DomInfo | undefined;

/** The recursive stand-in Node tests pass to `createFragment(cb)`: every helper returns the same inert object. */
export function installCreateFragmentStub(): void {
  (globalThis as { createFragment?: unknown }).createFragment = (cb?: (f: unknown) => void) => {
    const frag: Record<string, unknown> = {};
    frag.createSpan = () => frag;
    frag.createEl = () => frag;
    frag.createDiv = () => frag;
    frag.appendText = () => frag;
    cb?.(frag);
    return frag;
  };
}

function make(tag: string, info: ElInfo): HTMLElement {
  const el = document.createElement(tag);
  const o: DomInfo = typeof info === "string" ? { cls: info } : (info ?? {});
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o.text != null) el.textContent = o.text;
  if (o.title != null) el.title = o.title;
  if (o.attr) {
    for (const [k, v] of Object.entries(o.attr)) if (v !== null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  }
  const input = el as HTMLInputElement;
  if (o.type != null) input.type = o.type;
  if (o.value != null) input.value = o.value;
  if (o.placeholder != null) input.placeholder = o.placeholder;
  if (o.href != null) (el as HTMLAnchorElement).href = o.href;
  return el;
}

function attach(parent: HTMLElement, el: HTMLElement, info: ElInfo): HTMLElement {
  const o: DomInfo = typeof info === "string" || !info ? {} : info;
  if (o.prepend) parent.insertBefore(el, parent.firstChild);
  else parent.appendChild(el);
  return el;
}

let installed = false;

/** Idempotent. Call once from a DOM-environment test file (or the layout page) before building any view code. */
export function installObsidianDom(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

  g.createEl = (tag: string, info?: ElInfo) => make(tag, info);
  g.createDiv = (info?: ElInfo) => make("div", info);
  g.createSpan = (info?: ElInfo) => make("span", info);
  g.createFragment = (cb?: (f: DocumentFragment) => void) => {
    const f = document.createDocumentFragment();
    cb?.(f);
    return f;
  };

  proto.createEl = function (this: HTMLElement, tag: string, info?: ElInfo, cb?: (el: HTMLElement) => void) {
    const el = attach(this, make(tag, info), info);
    cb?.(el);
    return el;
  };
  proto.createDiv = function (this: HTMLElement, info?: ElInfo, cb?: (el: HTMLElement) => void) {
    const el = attach(this, make("div", info), info);
    cb?.(el);
    return el;
  };
  proto.createSpan = function (this: HTMLElement, info?: ElInfo, cb?: (el: HTMLElement) => void) {
    const el = attach(this, make("span", info), info);
    cb?.(el);
    return el;
  };
  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.addClass = function (this: HTMLElement, ...c: string[]) {
    this.classList.add(...c);
  };
  proto.removeClass = function (this: HTMLElement, ...c: string[]) {
    this.classList.remove(...c);
  };
  proto.hasClass = function (this: HTMLElement, c: string) {
    return this.classList.contains(c);
  };
  proto.toggleClass = function (this: HTMLElement, c: string | string[], on: boolean) {
    for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, on);
  };
  proto.setText = function (this: HTMLElement, t: string | DocumentFragment) {
    this.textContent = typeof t === "string" ? t : "";
    if (typeof t !== "string") this.appendChild(t);
  };
  proto.setAttr = function (this: HTMLElement, name: string, value: string | number | boolean | null) {
    if (value === null) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  };
  proto.hide = function (this: HTMLElement) {
    this.style.display = "none";
  };
  proto.show = function (this: HTMLElement) {
    this.style.display = "";
  };
  proto.isShown = function (this: HTMLElement) {
    return this.style.display !== "none";
  };
  proto.toggle = function (this: HTMLElement, on?: boolean) {
    const show = on ?? !(this as unknown as { isShown(): boolean }).isShown();
    this.style.display = show ? "" : "none";
  };
  proto.find = function (this: HTMLElement, selector: string) {
    return this.querySelector(selector);
  };
}
