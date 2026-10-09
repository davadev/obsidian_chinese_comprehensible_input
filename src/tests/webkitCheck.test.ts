import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * #119: `npm run check:webkit` is only worth anything while its pieces stay wired together. These are text-level pins
 * (the check itself needs a browser, so it runs as its own CI job, `webkit` in ci.yml).
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("the WebKit layout check", () => {
  it("keeps the beta.4 stylesheet as a canary that actually contains the regression", () => {
    const canary = read("scripts/eink-layout/fixtures/styles-0.7.8-beta.4.css");
    // The numbered HSK word is `white-space: nowrap` in beta.4: Blink tolerated it, WebKit overflowed sideways.
    expect(canary).toMatch(
      /\.cci-view\[data-eink\] \.cci-word:not\(\.cci-stack\):is\([^)]*\.cci-color-hsk-1[^)]*\)\s*\{\s*white-space:\s*nowrap;/
    );
    // ...and the shipped stylesheet must not have it back.
    expect(read("styles.css")).not.toMatch(/\.cci-color-hsk-1[^{]*\{\s*white-space:\s*nowrap/);
  });

  it("drives the layout harness's overflow task, and the harness still has it", () => {
    expect(read("scripts/check-webkit-layout.mjs")).toContain("task=overflow");
    expect(read("scripts/eink-layout/entry.ts")).toContain('task === "overflow"');
  });

  it("fails rather than passes when the canary no longer overflows", () => {
    const script = read("scripts/check-webkit-layout.mjs");
    expect(script).toMatch(/bad\.over > 0/);
    expect(script).toContain("the gate above proves nothing");
  });

  it("is a script, an exact-pinned dev dependency (never runtime), and a CI job that downloads the browser at job time", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["check:webkit"]).toBe("node scripts/check-webkit-layout.mjs");
    expect(pkg.devDependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies?.playwright).toBeUndefined();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/npx playwright install --with-deps webkit/);
    expect(ci).toMatch(/npm run check:webkit/);
  });

  it("stays out of the release path, which must be offline and deterministic", () => {
    expect(read(".github/workflows/release.yml")).not.toMatch(/playwright|check:webkit|check:layout/);
    expect(read("scripts/check-release.mjs")).not.toMatch(/playwright|check:webkit/);
  });
});
