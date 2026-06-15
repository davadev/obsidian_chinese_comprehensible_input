import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";

class VaultFolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private current: string, private onPick: (path: string) => void) {
    super(app);
    this.setPlaceholder(`Current: ${current || "(vault root)"}`);
  }
  getItems(): TFolder[] {
    const out: TFolder[] = [];
    // Include vault root explicitly.
    const root = this.app.vault.getRoot();
    out.push(root);
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f !== root) out.push(f);
    }
    return out;
  }
  getItemText(f: TFolder): string {
    return f.path === "/" ? "/ (vault root)" : f.path;
  }
  onChooseItem(f: TFolder): void {
    this.onPick(f.path === "/" ? "" : f.path);
  }
}

class VaultFilePicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private current: string,
    private extensions: string[],
    private onPick: (path: string) => void
  ) {
    super(app);
    this.setPlaceholder(`Current: ${current || "(none)"}`);
  }
  getItems(): TFile[] {
    const exts = new Set(this.extensions.map((e) => e.toLowerCase()));
    const out: TFile[] = [];
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFile && exts.has(f.extension.toLowerCase())) out.push(f);
    }
    return out;
  }
  getItemText(f: TFile): string {
    return f.path;
  }
  onChooseItem(f: TFile): void {
    this.onPick(f.path);
  }
}

export function openVaultFolderPicker(
  app: App,
  current: string,
  onPick: (path: string) => void
): void {
  new VaultFolderPicker(app, current, onPick).open();
}

export function openVaultFilePicker(
  app: App,
  current: string,
  opts: { extensions: string[] },
  onPick: (path: string) => void
): void {
  new VaultFilePicker(app, current, opts.extensions, onPick).open();
}
