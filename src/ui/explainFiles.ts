import { App, Notice, TFile } from "obsidian";
import type CciPlugin from "../main";
import { saveExplainNote } from "../ai/explainNotes";
import { VIEW_TYPE_CHINESE } from "../constants";

/** Put Markdown on the clipboard and say whether that worked. */
export async function copyMarkdown(markdown: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown);
    new Notice(`${what} copied.`);
  } catch {
    new Notice("Could not copy to the clipboard.");
  }
}

/** Open a note in the reader, so the Chinese in it is annotated and tappable like any other note. */
export async function openInReader(app: App, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
}

/**
 * Save an explanation into the Explanations folder (never overwriting) and, if the setting says so, open it. Returns the
 * file, or null after telling the user why it could not be saved.
 */
export async function saveExplanation(
  app: App,
  plugin: Pick<CciPlugin, "settings">,
  fileName: string,
  markdown: string,
  what: string
): Promise<TFile | null> {
  try {
    const file = await saveExplainNote(app, plugin.settings.explain.folder, fileName, markdown);
    new Notice(`Saved ${file.path}`);
    if (plugin.settings.explain.openAfterSave) await openInReader(app, file);
    return file;
  } catch (err) {
    new Notice(`Could not save the ${what}: ${(err as Error).message}`);
    return null;
  }
}
