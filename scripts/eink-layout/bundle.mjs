// The browser half of the layout checks, bundled from the REAL source. Shared by check-eink-layout.mjs (Chromium) and
// check-webkit-layout.mjs (WebKit) so both measure exactly the same widget and harness.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";

/** @param {string} root repository root @returns {Promise<string>} the IIFE bundle of scripts/eink-layout/entry.ts */
export async function bundleHarness(root) {
  const exportRubyWidget = {
    name: "export-ruby-widget",
    setup(b) {
      // RubyWidget is private to chineseDecorations.ts. Expose it for this bundle only, in memory,
      // so the widget under test is the real one and src/ stays untouched.
      b.onLoad({ filter: /chineseDecorations\.ts$/ }, (args) => {
        const src = readFileSync(args.path, "utf8");
        if (!/^class RubyWidget extends/m.test(src)) throw new Error("RubyWidget declaration moved — update scripts/eink-layout/bundle.mjs");
        return { contents: src.replace(/^class RubyWidget extends/m, "export class RubyWidget extends"), loader: "ts", resolveDir: dirname(args.path) };
      });
    },
  };
  const bundle = await build({
    entryPoints: [join(root, "scripts/eink-layout/entry.ts")],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "warning",
    alias: { obsidian: join(root, "src/tests/__mocks__/obsidian.ts") },
    plugins: [exportRubyWidget],
  });
  return bundle.outputFiles[0].text;
}

/** The page chrome both runners put around styles.css: just enough Obsidian theme variables to render. */
export const THEME =
  ":root{--background-primary:#fff;--background-primary-alt:#f5f5f5;--background-modifier-border:#e0e0e0;--text-normal:#222;--text-muted:#7a7a7a;--text-faint:#a0a0a0;--interactive-accent:#7f6df2;font-family:-apple-system,sans-serif}html,body{margin:0;background:#fff}";
