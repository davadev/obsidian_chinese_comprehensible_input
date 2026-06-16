/**
 * Test-only stub of the Obsidian runtime API. Real Obsidian is only present
 * inside the host app — for unit tests we only need symbols to satisfy
 * `import` so module evaluation doesn't fail.
 */
export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {
  constructor(_el: any) {}
  setName(_: string) { return this; }
  setDesc(_: string) { return this; }
  addText(_: any) { return this; }
  addToggle(_: any) { return this; }
  addDropdown(_: any) { return this; }
  addButton(_: any) { return this; }
}
export class Modal {}
export class Notice {
  message: string;
  constructor(message: string) { this.message = message; }
  setMessage(message: string) { this.message = message; }
  hide() {}
}
export class ItemView {}
export class TextFileView {}
export class WorkspaceLeaf {}
export class TFile {}
export const Platform = { isMobile: false, isIosApp: false, isAndroidApp: false };
export function normalizePath(p: string): string { return p; }
export async function requestUrl(_p: any): Promise<{ status: number; text: string; arrayBuffer: ArrayBuffer }> {
  return { status: 200, text: "", arrayBuffer: new ArrayBuffer(0) };
}
