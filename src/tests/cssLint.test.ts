import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Obsidian's review lints styles.css; `npm run lint` (ESLint over src/**\/*.ts) never did, and 0.7.8 shipped 11
 * findings from it. That is now `npm run lint:css` (stylelint, see stylelint.config.mjs), run by ci.yml, release.yml
 * and `check-release --with-lint`. The hand-made grep list that used to live here and in check-release is gone.
 * What is pinned below is only the wiring, plus two unrelated `--cci-mark-bg` pins.
 */

const css = readFileSync("styles.css", "utf8");

describe("styles.css lint wiring", () => {
  const config = readFileSync("stylelint.config.mjs", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("stylelint enforces the two checks Obsidian's review applies, against a pinned browser target", () => {
    expect(config).toContain('"declaration-no-important": true');
    expect(config).toContain("plugin/no-unsupported-browser-features");
    expect(config).toMatch(/browsers:\s*\["chrome 138"\]/);
    // `warning` would let the findings through CI: a warning in the review is still a finding on the plugin's page.
    expect(config).toMatch(/severity:\s*"error"/);
  });

  it("npm run lint:css exists, and both stylelint packages are exact-pinned dev dependencies", () => {
    expect(pkg.scripts["lint:css"]).toBe("stylelint styles.css");
    for (const name of ["stylelint", "stylelint-no-unsupported-browser-features"]) {
      expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkg.dependencies?.[name], `${name} must not be a runtime dependency`).toBeUndefined();
    }
  });

  it("CI and the release workflow both run lint:css", () => {
    for (const wf of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      expect(readFileSync(wf, "utf8"), wf).toMatch(/run:\s*npm run lint:css/);
    }
  });
});

describe("styles.css highlight colour", () => {
  it("the code that colours a highlight writes the custom property, never an inline background", () => {
    // An inline background could only be overridden with !important (E-ink mode needed two). These files need a
    // DOM harness to run (#119), so this is a text-level pin on the call sites.
    const md = readFileSync("src/editor/markdownRendering.ts", "utf8");
    const deco = readFileSync("src/editor/chineseDecorations.ts", "utf8");
    expect(md).toContain("`--cci-mark-bg:${span.color};`");
    expect(md).toContain('el.style.setProperty("--cci-mark-bg", bg)');
    expect(deco).toContain('stack.style.setProperty("--cci-hl", this.highlightBg)'); // the annotation stack carries it as a custom property too
    for (const [name, src] of [["markdownRendering.ts", md], ["chineseDecorations.ts", deco]] as const) {
      expect(src, `${name} writes an inline background`).not.toMatch(/background-color:\$\{|style\.backgroundColor\s*=/);
    }
  });

  it("the base rules read --cci-mark-bg, falling back to the plain highlight colour", () => {
    expect(css).toMatch(/\.cci-view \.cci-md-highlight\s*\{[^}]*background:\s*var\(--cci-mark-bg,\s*var\(--text-highlight-bg/);
    expect(css).toMatch(/\.cci-view \.cci-md-link-hl,\s*\.cci-view \.cci-md-link-hl:hover\s*\{[^}]*background-color:\s*var\(--cci-mark-bg\)/);
  });
});
