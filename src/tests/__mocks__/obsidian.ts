/**
 * Test-only stub of the Obsidian runtime API. Real Obsidian is only present
 * inside the host app — for unit tests we only need symbols to satisfy
 * `import` so module evaluation doesn't fail.
 */
export class App {}
export class Plugin {}
export class PluginSettingTab {
  // Real Obsidian assigns both and exposes update() for declarative tabs;
  // settingsCoverage.test.ts drives a real subclass through this.
  constructor(public app: any, public plugin: any) {}
  update() {}
  refreshDomState() {}
}
const hasDom = (): boolean => typeof document !== "undefined";
const isNode = (x: unknown): x is Node => !!x && typeof (x as Node).appendChild === "function";

/** Fluent component stand-ins: real elements when there is a `document`, plain state either way. */
class FakeComponent {
  disabled = false;
  setDisabled(v: boolean) { this.disabled = v; return this; }
}
class FakeText extends FakeComponent {
  inputEl: HTMLInputElement | HTMLTextAreaElement;
  private cb: ((v: string) => unknown) | null = null;
  constructor(parent: unknown, tag: "input" | "textarea") {
    super();
    this.inputEl = (hasDom() ? document.createElement(tag) : { value: "", placeholder: "", addEventListener() {} }) as HTMLInputElement;
    if (isNode(parent)) parent.appendChild(this.inputEl);
    this.inputEl.addEventListener?.("input", () => this.cb?.(this.inputEl.value));
  }
  setValue(v: string) { this.inputEl.value = v; return this; }
  getValue() { return this.inputEl.value; }
  setPlaceholder(v: string) { this.inputEl.placeholder = v; return this; }
  onChange(fn: (v: string) => unknown) { this.cb = fn; return this; }
}
class FakeToggle extends FakeComponent {
  value = false;
  private cb: ((v: boolean) => unknown) | null = null;
  setValue(v: boolean) { this.value = v; return this; }
  getValue() { return this.value; }
  onChange(fn: (v: boolean) => unknown) { this.cb = fn; return this; }
  /** Test helper: what a click on the switch does. */
  toggle() { this.value = !this.value; return this.cb?.(this.value); }
}
class FakeDropdown extends FakeComponent {
  selectEl: HTMLSelectElement;
  private cb: ((v: string) => unknown) | null = null;
  constructor(parent: unknown) {
    super();
    this.selectEl = (hasDom() ? document.createElement("select") : { value: "", appendChild() {}, addEventListener() {} }) as HTMLSelectElement;
    if (isNode(parent)) parent.appendChild(this.selectEl);
    this.selectEl.addEventListener?.("change", () => this.cb?.(this.selectEl.value));
  }
  addOption(value: string, label: string) {
    if (hasDom()) { const o = document.createElement("option"); o.value = value; o.textContent = label; this.selectEl.appendChild(o); }
    return this;
  }
  setValue(v: string) { this.selectEl.value = v; return this; }
  getValue() { return this.selectEl.value; }
  onChange(fn: (v: string) => unknown) { this.cb = fn; return this; }
}
class FakeButton extends FakeComponent {
  buttonEl: HTMLButtonElement;
  cta = false;
  warning = false;
  constructor(parent: unknown) {
    super();
    this.buttonEl = (hasDom() ? document.createElement("button") : { textContent: "", addClass() {}, addEventListener() {} }) as HTMLButtonElement;
    if (isNode(parent)) parent.appendChild(this.buttonEl);
  }
  setButtonText(t: string) { this.buttonEl.textContent = t; return this; }
  setCta() { this.cta = true; return this; }
  setWarning() { this.warning = true; return this; }
  onClick(fn: (evt: MouseEvent) => unknown) { this.buttonEl.addEventListener?.("click", fn as EventListener); return this; }
}

export class Setting {
  settingEl: HTMLElement;
  controlEl: HTMLElement;
  nameText = "";
  descText = "";
  constructor(containerEl: any) {
    this.settingEl = (hasDom() ? document.createElement("div") : {}) as HTMLElement;
    this.controlEl = (hasDom() ? document.createElement("div") : {}) as HTMLElement;
    if (hasDom()) {
      this.settingEl.className = "setting-item";
      this.settingEl.appendChild(this.controlEl);
      if (isNode(containerEl)) containerEl.appendChild(this.settingEl);
    }
  }
  setName(v: string) { this.nameText = v; return this; }
  setDesc(v: string) { this.descText = v; return this; }
  setHeading() { return this; }
  setClass(c: string) { (this.settingEl as HTMLElement).classList?.add(c); return this; }
  addText(cb: (c: FakeText) => unknown) { cb(new FakeText(this.controlEl, "input")); return this; }
  addTextArea(cb: (c: FakeText) => unknown) { cb(new FakeText(this.controlEl, "textarea")); return this; }
  addToggle(cb: (c: FakeToggle) => unknown) { cb(new FakeToggle()); return this; }
  addDropdown(cb: (c: FakeDropdown) => unknown) { cb(new FakeDropdown(this.controlEl)); return this; }
  addButton(cb: (c: FakeButton) => unknown) { cb(new FakeButton(this.controlEl)); return this; }
}
export class Modal {
  // The real class owns a lot more; this keeps the parts the plugin's modals use. Outside a DOM test (plain Node) the
  // elements simply do not exist and a test that needs one assigns it.
  app: unknown;
  containerEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  modalEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  titleEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  contentEl: any = hasDom() ? document.createElement("div") : undefined;
  private isOpen = false;
  constructor(app?: unknown) {
    this.app = app;
    if (hasDom()) {
      this.containerEl.appendChild(this.modalEl);
      this.modalEl.appendChild(this.titleEl);
      this.modalEl.appendChild(this.contentEl);
    }
  }
  onOpen(): void {}
  onClose(): void {}
  open() {
    this.isOpen = true;
    if (hasDom()) document.body.appendChild(this.containerEl);
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
    this.containerEl?.remove?.();
  }
}
export class Notice {
  /** Every notice shown since the last `Notice.instances.length = 0`, so a test can assert what the user was told. */
  static instances: Notice[] = [];
  message: string;
  /** Milliseconds the notice stays (0 = until dismissed), as passed by the caller. */
  duration?: number;
  constructor(message: string, duration?: number) { this.message = message; this.duration = duration; Notice.instances.push(this); }
  setMessage(message: string) { this.message = message; }
  hide() {}
}
export class ItemView {}
export class TextFileView {
  /** Obsidian's header action: recorded so a test can assert which actions a view registered. */
  actions: Array<{ icon: string; title: string; cb: (evt: unknown) => unknown }> = [];
  requestSave(): void {}
  addAction(icon: string, title: string, cb: (evt: unknown) => unknown): unknown {
    this.actions.push({ icon, title, cb });
    return {};
  }
}
export class WorkspaceLeaf {}
export class TFile {}
export const Platform = { isMobile: false, isIosApp: false, isAndroidApp: false };
/** Like the app's: forward slashes, no doubled, leading or trailing slash. */
export function normalizePath(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  return n === "" ? "/" : n;
}
export async function requestUrl(_p: any): Promise<{ status: number; text: string; arrayBuffer: ArrayBuffer }> {
  return { status: 200, text: "", arrayBuffer: new ArrayBuffer(0) };
}

/** Records the icon name on the element instead of rendering an SVG; enough for tests that assert which icon a button got. */
export function setIcon(el: { setAttribute?: (k: string, v: string) => void }, name: string): void {
  el.setAttribute?.("data-icon", name);
}
