import { describe, expect, it, vi } from "vitest";
import { EnhanceDictionaryService } from "../ai/EnhanceDictionaryService";
import {
  ENHANCE_PINYIN_CLAUSE,
  ENHANCE_SYSTEM_PROMPT,
  buildEnhanceSchema,
} from "../ai/prompts";
import type { AiProviderService } from "../ai/AiProviderService";
import type { CciSettings } from "../settings/types";

interface RecordedCall {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
}

function makeService(
  reply: string,
  opts: { allowPinyin?: boolean; record?: RecordedCall[] } = {}
): { svc: EnhanceDictionaryService; calls: RecordedCall[] } {
  const calls = opts.record ?? [];
  const fakeAi = {
    chatJson: vi.fn(
      async (system: string, user: string, schemaName: string, schema: object) => {
        calls.push({ system, user, schemaName, schema });
        return reply;
      }
    ),
  } as unknown as AiProviderService;
  const settings = {
    ai: { enabled: true, enhanceCanRewritePinyin: !!opts.allowPinyin },
  } as unknown as CciSettings;
  const svc = new EnhanceDictionaryService(fakeAi, () => settings);
  return { svc, calls };
}

const baseInput = {
  surface: "打",
  pinyin: "dǎ",
  traditional: "打",
  currentDefinitions: ["to hit; to strike", "to play (a game)", "dozen"],
  sentence: "我要打电话给我妈妈。",
};

describe("EnhanceDictionaryService.enhance", () => {
  it("returns the parsed definitions + grammar from a clean JSON reply", async () => {
    const reply = JSON.stringify({
      definitions: ["to make (a phone call)", "to hit; to strike"],
      grammar: "Common verb-object compound: 打 + noun.",
    });
    const { svc } = makeService(reply);
    const out = await svc.enhance(baseInput);
    expect(out.definitions[0]).toBe("to make (a phone call)");
    expect(out.definitions).toHaveLength(2);
    expect(out.grammar).toContain("verb-object");
    expect(out.pinyin).toBeUndefined();
  });

  it("tolerates markdown code fences around the JSON", async () => {
    const reply =
      "```json\n" +
      JSON.stringify({ definitions: ["to make (a phone call)"] }) +
      "\n```";
    const { svc } = makeService(reply);
    const out = await svc.enhance(baseInput);
    expect(out.definitions).toEqual(["to make (a phone call)"]);
  });

  it("throws when the JSON has no definitions field", async () => {
    const { svc } = makeService(JSON.stringify({ grammar: "n/a" }));
    await expect(svc.enhance(baseInput)).rejects.toThrow(/definitions/);
  });

  it("throws when the JSON is not parseable", async () => {
    const { svc } = makeService("not json at all");
    await expect(svc.enhance(baseInput)).rejects.toThrow();
  });

  it("throws when every definition is empty", async () => {
    const { svc } = makeService(JSON.stringify({ definitions: ["", "   "] }));
    await expect(svc.enhance(baseInput)).rejects.toThrow(/no usable definitions/);
  });

  it("drops pinyin from the reply when the setting is off (default)", async () => {
    const reply = JSON.stringify({
      definitions: ["to make (a phone call)"],
      pinyin: "dǎ",
    });
    const calls: RecordedCall[] = [];
    const { svc } = makeService(reply, { allowPinyin: false, record: calls });
    const out = await svc.enhance(baseInput);
    expect(out.pinyin).toBeUndefined();
    // System prompt must not invite the model to send pinyin.
    expect(calls[0].system).toBe(ENHANCE_SYSTEM_PROMPT);
    expect(calls[0].system).not.toContain(ENHANCE_PINYIN_CLAUSE.trim());
    // Schema must not declare pinyin as a property.
    expect(calls[0].schema).toEqual(buildEnhanceSchema(false));
  });

  it("accepts pinyin from the reply when the setting is on, and asks for it in the system prompt", async () => {
    const reply = JSON.stringify({
      definitions: ["to make (a phone call)"],
      pinyin: "dǎ",
    });
    const calls: RecordedCall[] = [];
    const { svc } = makeService(reply, { allowPinyin: true, record: calls });
    const out = await svc.enhance(baseInput);
    expect(out.pinyin).toBe("dǎ");
    expect(calls[0].system).toContain(ENHANCE_PINYIN_CLAUSE.trim());
    expect(calls[0].schema).toEqual(buildEnhanceSchema(true));
  });

  it("sends the surface, pinyin, traditional, current defs, and sentence in the user prompt", async () => {
    const reply = JSON.stringify({ definitions: ["to make (a phone call)"] });
    const calls: RecordedCall[] = [];
    const { svc } = makeService(reply, { record: calls });
    await svc.enhance(baseInput);
    const user = calls[0].user;
    expect(user).toContain(baseInput.surface);
    expect(user).toContain(baseInput.pinyin);
    expect(user).toContain(baseInput.currentDefinitions[0]);
    expect(user).toContain(baseInput.sentence);
  });
});
