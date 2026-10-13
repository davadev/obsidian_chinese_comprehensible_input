import { describe, expect, it } from "vitest";
import { RELEASE_NOTES, ReleaseNote, baseVersion, latestNote, notesOfLine, notesToShow } from "../ui/whatsNew/releaseNotes";
import { aiConfigured } from "../ai/aiConfigured";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * The one-time "What's new" popup: which entries a user is shown after an upgrade. The rule that matters is that the
 * same entry is never shown twice, whatever mix of stable and beta builds the user passes through.
 */

const note = (version: string): ReleaseNote => ({ version, title: `v${version}`, intro: "", items: [] });
const NOTES = [note("0.10.0"), note("0.9.1"), note("0.9.0")];

describe("baseVersion", () => {
  it("reads X.Y.Z and ignores a prerelease or build suffix", () => {
    expect(baseVersion("0.9.0")).toEqual([0, 9, 0]);
    expect(baseVersion("0.9.0-beta.7")).toEqual([0, 9, 0]);
    expect(baseVersion(" 1.12.3+abc ")).toEqual([1, 12, 3]);
  });

  it("returns null for anything else", () => {
    for (const v of ["", "0.9", "x.y.z", "v0.9.0", "0.9.0.1"]) expect(baseVersion(v)).toBeNull();
  });
});

describe("notesToShow", () => {
  it("shows every entry up to the running version to someone who has never been told anything", () => {
    expect(notesToShow("", "0.9.1", NOTES).map((n) => n.version)).toEqual(["0.9.0", "0.9.1"]);
    expect(notesToShow("not a version", "0.9.0", NOTES).map((n) => n.version)).toEqual(["0.9.0"]);
  });

  it("shows only what is newer than the last version seen, oldest first", () => {
    expect(notesToShow("0.9.0", "0.10.0", NOTES).map((n) => n.version)).toEqual(["0.9.1", "0.10.0"]);
    expect(notesToShow("0.8.2", "0.9.0", NOTES).map((n) => n.version)).toEqual(["0.9.0"]);
  });

  it("shows nothing twice: once seen, a restart or a later beta of the same version shows nothing", () => {
    expect(notesToShow("0.9.0", "0.9.0", NOTES)).toEqual([]);
    expect(notesToShow("0.9.0-beta.8", "0.9.0-beta.9", NOTES)).toEqual([]);
    expect(notesToShow("0.9.0-beta.9", "0.9.0", NOTES)).toEqual([]);
    expect(notesToShow("0.9.0", "0.9.0-beta.1", NOTES)).toEqual([]);
  });

  it("shows a version's entry on its first beta, and does not show a version that has not arrived", () => {
    expect(notesToShow("0.8.2", "0.9.0-beta.8", NOTES).map((n) => n.version)).toEqual(["0.9.0"]);
    expect(notesToShow("0.8.2", "0.8.3", NOTES)).toEqual([]);
  });

  it("shows nothing when the running version is unreadable, and skips an entry with a bad version", () => {
    expect(notesToShow("", "weird", NOTES)).toEqual([]);
    expect(notesToShow("", "0.9.0", [note("bad"), note("0.9.0")]).map((n) => n.version)).toEqual(["0.9.0"]);
  });
});

describe("latestNote", () => {
  it("is the newest entry that is not newer than the running version", () => {
    expect(latestNote("0.9.5", NOTES)?.version).toBe("0.9.1");
    expect(latestNote("0.9.0-beta.3", NOTES)?.version).toBe("0.9.0");
    expect(latestNote("0.8.0", NOTES)).toBeNull();
  });
});

describe("notesOfLine", () => {
  const versions = (v: string) => notesOfLine(v, NOTES).map((n) => n.version);
  it("is every note of the running minor line, oldest first, and nothing of other lines", () => {
    expect(versions("0.9.1")).toEqual(["0.9.0", "0.9.1"]);
    expect(versions("0.9.0")).toEqual(["0.9.0"]);
    expect(versions("0.9.1-beta.2")).toEqual(["0.9.0", "0.9.1"]);
    expect(versions("0.10.0")).toEqual(["0.10.0"]);
  });
  it("does not show notes newer than the running version", () => {
    expect(versions("0.9.0-beta.3")).toEqual(["0.9.0"]);
  });
  it("falls back to the newest note when the running line has none of its own, and is empty without any", () => {
    expect(versions("0.9.5")).toEqual(["0.9.0", "0.9.1"]);
    expect(versions("0.11.0")).toEqual(["0.10.0"]);
    expect(versions("0.8.0")).toEqual([]);
    expect(versions("nonsense")).toEqual([]);
  });
});

describe("the shipped release notes", () => {
  it("are valid, newest first, and every item has a title and text", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    for (const n of RELEASE_NOTES) {
      expect(baseVersion(n.version)).not.toBeNull();
      // exactly X.Y.Z: a prerelease suffix would never match what the popup compares
      expect(n.version).toBe((baseVersion(n.version) as number[]).join("."));
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.items.length).toBeGreaterThan(0);
      for (const i of n.items) {
        expect(i.title.length).toBeGreaterThan(0);
        expect(i.text.length).toBeGreaterThan(0);
      }
    }
    const newestFirst = notesToShow("", "999.9.9", RELEASE_NOTES).reverse();
    expect(RELEASE_NOTES.map((n) => n.version)).toEqual(newestFirst.map((n) => n.version));
  });

  it("say what changed in 0.9.0: the merged button, mnemonics, word and sentence help, proof reading and the settings", () => {
    const titles = RELEASE_NOTES.find((n) => n.version === "0.9.0")?.items.map((i) => i.title.toLowerCase()).join(" | ") ?? "";
    expect(titles).toContain("one button for colouring");
    expect(titles).toContain("mnemonics");
    expect(titles).toContain("understand any word");
    expect(titles).toContain("whole sentence");
    expect(titles).toContain("check your own chinese");
    expect(titles).toContain("in control");
  });
});

describe("aiConfigured", () => {
  const ai = (over: object) => ({ ...DEFAULT_SETTINGS.ai, ...over });

  it("needs AI switched on", () => {
    expect(aiConfigured(ai({ enabled: false, provider: "openai" }), () => "sk-x")).toBe(false);
  });

  it("needs a key for OpenAI and a server address for Ollama", () => {
    expect(aiConfigured(ai({ enabled: true, provider: "openai" }), () => "sk-x")).toBe(true);
    expect(aiConfigured(ai({ enabled: true, provider: "openai" }), () => "  ")).toBe(false);
    expect(aiConfigured(ai({ enabled: true, provider: "ollama" }), () => "")).toBe(true);
    expect(aiConfigured(ai({ enabled: true, provider: "ollama", ollama: { ...DEFAULT_SETTINGS.ai.ollama, baseUrl: " " } }), () => "sk-x")).toBe(false);
  });
});
