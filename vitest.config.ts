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
        // These need a jsdom + Obsidian integration harness; we track the
        // pure logic modules here and test the UI/runtime layer separately.
        "src/main.ts",
        "src/ai/AiProviderService.ts",
        "src/ai/StoryGenerator.ts",
        "src/editor/chineseDecorations.ts",
        "src/editor/markdownRendering.ts",
        "src/editor/wordInteractionPlugin.ts",
        "src/settings/SettingsMirror.ts",
        "src/settings/SettingsTab.ts",
        "src/settings/StatusPriorityList.ts",
        "src/ui/EditDictionaryModal.ts",
        "src/ui/GenerateStoryModal.ts",
        "src/ui/PathPickers.ts",
        "src/ui/SettingsConflictModal.ts",
        "src/ui/StatsGraph.ts",
        "src/ui/StatsView.ts",
        "src/ui/WordPopup.ts",
        "src/view/ChineseTextFileView.ts",
        "src/view/ViewToolbar.ts",
      ],
      // Thresholds creep up as we add tests. Current values are the
      // floor — CI fails if we regress. Bump after each coverage push
      // so we ratchet toward 100% on pure-logic modules and accept
      // realistic ceilings on DOM-heavy code.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 73,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      // The `obsidian` package ships only type defs at runtime. Tests that
      // transitively import it get a tiny stub.
      obsidian: path.resolve(__dirname, "src/tests/__mocks__/obsidian.ts"),
    },
  },
});
