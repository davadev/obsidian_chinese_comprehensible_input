/**
 * Bundles the plugin's real AI code for Node, with `obsidian` swapped for a tiny shim and BOTH hardcoded OpenAI model
 * ids replaced by env lookups (falling back to the shipped id). One bundle then serves any candidate: set
 * EVAL_ID_default or EVAL_ID_legacy before importing it.
 */
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import esbuild from "esbuild";

export async function buildEvalBundle(root, entry) {
  const dir = mkdtempSync(path.join(tmpdir(), "cci-eval-"));
  const outfile = path.join(dir, "eval.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    outfile,
    logLevel: "warning",
    alias: { obsidian: path.join(root, "scripts/model-eval/obsidian-shim.mjs") },
    plugins: [
      {
        name: "env-model-ids",
        setup(build) {
          build.onLoad({ filter: /openaiProfile\.ts$/ }, async (args) => {
            let src = await readFile(args.path, "utf8");
            for (const [constName, role] of [["OPENAI_MODEL_ID", "default"], ["OPENAI_LEGACY_MODEL_ID", "legacy"]]) {
              const re = new RegExp(`export const ${constName} = "([^"]+)";`);
              const m = re.exec(src);
              if (!m) throw new Error(`Could not patch ${constName} in openaiProfile.ts`);
              src = src.replace(re, `export const ${constName} = process.env.EVAL_ID_${role} || "${m[1]}";`);
            }
            return { contents: src, loader: "ts" };
          });
        },
      },
    ],
  });
  return outfile;
}
