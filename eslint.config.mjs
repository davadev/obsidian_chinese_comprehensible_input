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

      // The auto-review DOES run this one: it is the rule behind the
      // "'X' is an 'error' type that acts as 'any'" rows that head its report,
      // and those rows are the tell that the scanner could not resolve a type
      // at all. Reproduced its exact messages and line numbers locally. Costs
      // nothing here (0 warnings) because these types resolve for us, and
      // `npm run lint:cloud-parity` relies on it to mirror the scanner's view.
      "@typescript-eslint/no-redundant-type-constituents": "warn",

      // Off deliberately. `obsidianmd/ui/sentence-case*` is noisy on
      // human-language UI labels (HSK / OpenAI / pinyin). The rest are off
      // because they flag patterns this codebase uses intentionally; measured
      // cost if re-enabled today is no-base-to-string 1 and require-await 8,
      // while restrict-template-expressions, unbound-method and
      // no-empty-object-type are currently 0 and could be turned on whenever
      // someone wants the extra coverage.
      //
      // NOTE: do not assume the cloud auto-review skips a rule just because it
      // is listed here — that assumption was wrong for
      // no-redundant-type-constituents above. Verify before claiming it.
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
