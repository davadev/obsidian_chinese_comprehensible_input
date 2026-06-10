import { describe, it, expect } from "vitest";
import { parseCedict } from "../dictionary/DictionaryDownloader";

describe("CC-CEDICT parser", () => {
  const sample = [
    "# CC-CEDICT",
    "# Version: 1.0",
    "中國 中国 [Zhong1 guo2] /China/Middle Kingdom/",
    "你好 你好 [ni3 hao3] /hello/hi/",
    "馬上 马上 [ma3 shang4] /at once/immediately/",
    "# comment in middle",
    "研究生 研究生 [yan2 jiu1 sheng1] /graduate student/postgraduate/",
    "",
  ].join("\n");

  it("parses entries and captures version line", () => {
    const { entries, versionLine } = parseCedict(sample);
    expect(entries.length).toBe(4);
    expect(versionLine).toContain("CC-CEDICT");
    const ma = entries.find((e) => e.simplified === "马上");
    expect(ma).toBeDefined();
    expect(ma!.traditional).toBe("馬上");
    expect(ma!.definitions).toContain("at once");
  });

  it("converts numbered pinyin to tone marks", () => {
    const { entries } = parseCedict(sample);
    const zg = entries.find((e) => e.simplified === "中国");
    expect(zg!.pinyin).toContain("ō");
    expect(zg!.pinyin).toContain("ó");
  });
});
