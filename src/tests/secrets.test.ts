import { describe, expect, it, vi } from "vitest";
import { clearLegacyKey, loadApiKey, migrateLegacyKeys } from "../ai/secrets";

function fakeApp(legacy: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
  const store = new Map(Object.entries(secrets));
  const app = {
    loadLocalStorage: vi.fn((k: string) => legacy[k] ?? null),
    saveLocalStorage: vi.fn(),
    secretStorage: {
      getSecret: vi.fn((id: string) => store.get(id) ?? null),
      setSecret: vi.fn((id: string, v: string) => void store.set(id, v)),
      listSecrets: vi.fn(() => [...store.keys()]),
    },
  };
  return { app: app as any, store };
}
const names = (openai = "", ollama = "") => ({ keySecrets: { openai, ollama } });

describe("loadApiKey", () => {
  it("reads the named secret", () => {
    const { app } = fakeApp({}, { mine: "sk-live" });
    expect(loadApiKey(app, names("mine"), "openai")).toBe("sk-live");
    expect(app.loadLocalStorage).not.toHaveBeenCalled();
  });

  it("falls back to the pre-0.9.2 localStorage copy when no secret is named or the secret is empty", () => {
    const { app } = fakeApp({ "cci-ai-apikey-openai": "sk-old" });
    expect(loadApiKey(app, names(), "openai")).toBe("sk-old");
    expect(loadApiKey(app, names("gone"), "openai")).toBe("sk-old");
    expect(app.secretStorage.getSecret).toHaveBeenCalledTimes(1);
  });

  it("is empty when there is nothing, and ignores a localStorage value that is not a string", () => {
    expect(loadApiKey(fakeApp().app, names(), "ollama")).toBe("");
    expect(loadApiKey(fakeApp({ "cci-ai-apikey-ollama": 123 }).app, names(), "ollama")).toBe("");
  });
});

describe("clearLegacyKey", () => {
  it("removes the localStorage copy", () => {
    const { app } = fakeApp();
    clearLegacyKey(app, "openai");
    expect(app.saveLocalStorage).toHaveBeenCalledWith("cci-ai-apikey-openai", null);
  });
});

describe("migrateLegacyKeys", () => {
  it("moves a localStorage key into a secret, remembers its name, and keeps the old copy for a downgrade", () => {
    const { app, store } = fakeApp({ "cci-ai-apikey-openai": "sk-old" });
    const ai = names();
    expect(migrateLegacyKeys(app, ai)).toBe(true);
    expect(ai.keySecrets).toEqual({ openai: "cci-openai-api-key", ollama: "" });
    expect(store.get("cci-openai-api-key")).toBe("sk-old");
    expect(app.saveLocalStorage).not.toHaveBeenCalled();
  });

  it("is idempotent and leaves a provider that already names a secret alone", () => {
    const { app } = fakeApp({ "cci-ai-apikey-openai": "sk-old", "cci-ai-apikey-ollama": "tok" });
    const ai = names("picked");
    expect(migrateLegacyKeys(app, ai)).toBe(true);
    expect(ai.keySecrets.openai).toBe("picked");
    expect(ai.keySecrets.ollama).toBe("cci-ollama-api-key");
    expect(migrateLegacyKeys(app, ai)).toBe(false);
  });

  it("does nothing when there is no key to move", () => {
    const { app } = fakeApp();
    expect(migrateLegacyKeys(app, names())).toBe(false);
    expect(app.secretStorage.setSecret).not.toHaveBeenCalled();
  });

  it("never overwrites another secret that has the same id: it takes the next free one", () => {
    const { app, store } = fakeApp(
      { "cci-ai-apikey-openai": "sk-old" },
      { "cci-openai-api-key": "someone-else", "cci-openai-api-key-2": "also-taken" }
    );
    const ai = names();
    migrateLegacyKeys(app, ai);
    expect(ai.keySecrets.openai).toBe("cci-openai-api-key-3");
    expect(store.get("cci-openai-api-key")).toBe("someone-else");
    expect(store.get("cci-openai-api-key-3")).toBe("sk-old");
  });

  it("reuses an id that already holds the same key", () => {
    const { app } = fakeApp({ "cci-ai-apikey-openai": "sk-old" }, { "cci-openai-api-key": "sk-old" });
    const ai = names();
    migrateLegacyKeys(app, ai);
    expect(ai.keySecrets.openai).toBe("cci-openai-api-key");
  });

  it("adopts a key rescued from an older settings shape ahead of localStorage", () => {
    const { app, store } = fakeApp({ "cci-ai-apikey-ollama": "stale" });
    const ai = names();
    migrateLegacyKeys(app, ai, { ollama: "rescued" });
    expect(store.get("cci-ollama-api-key")).toBe("rescued");
  });
});
