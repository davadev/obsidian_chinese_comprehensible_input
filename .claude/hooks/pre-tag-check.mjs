#!/usr/bin/env node
// PreToolUse hook for Bash: before Claude creates or pushes a release tag, run the release guard and the
// Obsidian-parity lint. A failure blocks the command (exit 2) and shows Claude the output, so a tag can never be
// pushed past `check-release`. Anything that is not a release-tag command passes straight through.
import { spawnSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command = "";
try {
  command = JSON.parse(input)?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const createsTag = new RegExp(String.raw`\bgit\s+tag\s+(?:-[a-zA-Z]+\s+)*${SEMVER}\b`).test(command);
const pushesTag = new RegExp(String.raw`\bgit\s+push\b[^\n;&|]*\s(?:refs/tags/)?${SEMVER}\b`).test(command) || /\bgit\s+push\b[^\n;&|]*--tags\b/.test(command);
if (!createsTag && !pushesTag) process.exit(0);

const run = spawnSync("npm", ["run", "check-release", "--", "--with-lint"], { encoding: "utf8", cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
if (run.status === 0) process.exit(0);

process.stderr.write(
  `Release tag blocked: \`npm run check-release -- --with-lint\` failed (exit ${run.status}).\n` +
    `Fix it (see the release-beta skill) before tagging.\n\n${(run.stdout || "").split("\n").slice(-40).join("\n")}\n${run.stderr || ""}`
);
process.exit(2);
