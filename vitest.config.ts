import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // The `obsidian` package ships only type defs at runtime. Tests that
      // transitively import it get a tiny stub.
      obsidian: path.resolve(__dirname, "src/tests/__mocks__/obsidian.ts"),
    },
  },
});
