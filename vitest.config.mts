import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["src/tests/__mocks__/setup.ts"],
    coverage: {
      // v8 is faster and produces accurate line/branch numbers for our
      // TypeScript-via-esbuild build pipeline. Reporters: text in the
      // terminal, html for browsable drill-down at coverage/index.html,
      // lcov for CI / editor plugins, json-summary for the npm script
      // that prints a single-line totals line.
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/tests/**",
        "src/**/*.d.ts",
        // Exclude pure type-definition modules — no executable lines.
        "src/settings/types.ts",
        "src/vocabulary/VocabularyTypes.ts",
        "src/tokenizer/tokenizerTypes.ts",
        "src/dictionary/DictionaryTypes.ts",
        "src/ai/aiTypes.ts",
        "src/ai/prompts.ts",
        // Exclude Obsidian runtime / DOM-heavy shells from unit-test coverage.
        // ViewToolbar.ts and ChineseTextFileView.ts left this list in 0.8.0: a happy-dom
        // harness (src/tests/*.dom.test.ts, with the shared Obsidian DOM fixture) mounts the
        // real toolbar and the real view with a real CodeMirror editor. What is still here
        // needs more of Obsidian than that fixture provides (#119).
        "src/main.ts",
        "src/ai/AiProviderService.ts",
        "src/ai/StoryGenerator.ts",
        "src/editor/chineseDecorations.ts",
        "src/editor/markdownRendering.ts",
        "src/editor/wordInteractionPlugin.ts",
        "src/settings/SettingsTab.ts",
        "src/settings/StatusPriorityList.ts",
        "src/settings/FormatOptionsList.ts",
        "src/ui/confirmInput.ts",
        "src/ui/EditDictionaryModal.ts",
        "src/ui/MnemonicModal.ts",
        "src/ui/modalLayer.ts",
        "src/ui/GenerateStoryModal.ts",
        "src/ui/PathPickers.ts",
        "src/ui/StatsGraph.ts",
        "src/ui/StatsView.ts",
        "src/ui/WordPopup.ts",
      ],
      // Thresholds creep up as we add tests. Current values are the
      // floor — CI fails if we regress. Bump after each coverage push
      // so we ratchet toward 100% on pure-logic modules and accept
      // realistic ceilings on DOM-heavy code.
      //
      // The vitest 1 -> 4 upgrade re-based these. v1's v8 provider only
      // reported files a test actually imported, so modules nothing imported
      // were silently absent from the denominator and the headline number was
      // inflated (92.47% statements). v4 honours `include` literally and
      // counts the whole declared surface, which is the honest measure.
      //
      // 0.7.6 closed the pure-logic gaps: formatOptions.ts went 4.76% -> 100%,
      // and axes / markdownExclusionRanges / TokenizerService / colorTheme /
      // syncMerge / SrsScheduler all moved into the 94-100% band. Measured
      // 87.71 stmts / 82.92 br / 87.95 fn / 90.05 lines; the floors below sit
      // just under that so an accidental regression fails CI.
      //
      // 0.7.8 moved SettingsMirror.ts and SettingsConflictModal.ts INTO the denominator (both are
      // unit-tested now, and both carry the #123 / #124 fixes), added the dictionary download
      // pipeline (real gzip / ZIP bytes, no network) and the vault-mirror / import failure paths.
      // Measured 97.56 stmts / 91.34 br / 98.49 fn / 99.2 lines; the floors sit just under that.
      // DictionaryDownloader used to be the one gap left in the denominator on purpose; it is
      // covered now. Raise these numbers by testing, not by widening `exclude`.
      //
      // 0.8.0 moved ViewToolbar.ts and ChineseTextFileView.ts INTO the denominator (#119): ~1,400 lines of
      // real UI, mounted under happy-dom with a real CodeMirror editor. Measured with them in:
      // 97.48 stmts / 91.15 br / 98.32 fn / 99.02 lines (ViewToolbar 97%, ChineseTextFileView 95%), i.e.
      // higher than before, so statements and functions were raised by one point.
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 90,
        statements: 97,
      },
    },
  },
  resolve: {
    alias: {
      // The `obsidian` package ships only type defs at runtime. Tests that
      // transitively import it get a tiny stub.
      obsidian: path.resolve(import.meta.dirname, "src/tests/__mocks__/obsidian.ts"),
    },
  },
});
