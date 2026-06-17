// Local mirror of the Obsidian community-plugin auto-review's lint set.
// `npm run lint` MUST return 0 Errors before a release ships, otherwise
// the cloud lint will fail the submission and risk delisting the
// plugin. See docs/release-process.md for the wider context.
//
// Rule severities are tuned so the local output matches what the cloud
// review reports — the cloud rates the no-unsafe-* cluster and the
// floating/misused-Promise rules as Warnings (non-blocking), and the
// `*-deprecated` rules as Recommendations. We mirror those as `warn`
// here so a lint pass against unchanged code surfaces the same set of
// warnings the auto-review would, and only NEW Errors block a release.
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "esbuild.config.mjs",
      "scripts/**",
      "src/tests/**",
      "src/**/*.d.ts",
      "node_modules",
      "coverage",
      "eslint.config.mjs",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Auto-review marks bare `any` as an Error.
      "@typescript-eslint/no-explicit-any": "error",

      // Auto-review surfaces these as Warnings — they're load-bearing
      // notes about loadData() / app.plugins / LLM-response handling
      // patterns that would need a bigger typing pass to eliminate.
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",

      // Auto-review surfaces these as Recommendations.
      "@typescript-eslint/no-deprecated": "warn",

      // The auto-review doesn't include these rules — they're noisy on
      // human-language UI labels (HSK / OpenAI etc.) and on TS narrowings
      // that the cloud lint doesn't flag.
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
