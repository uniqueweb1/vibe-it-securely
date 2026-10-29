#!/usr/bin/env node
import path from "node:path";
import { init } from "../src/init.js";

const args = process.argv.slice(2);
const cmd = args[0];
const dryRun = args.includes("--dry-run");
const dirIdx = args.indexOf("--dir");
const dir = path.resolve(dirIdx >= 0 ? args[dirIdx + 1] : process.cwd());

const HELP = `secure-baseline - generate a security baseline for your project

Usage:
  secure-baseline init [--dir <path>] [--dry-run]

Existing files are never overwritten. If a file already exists, the new
version is saved next to it as <name>.suggested for you to review.`;

if (cmd !== "init") {
  console.log(HELP);
  process.exit(cmd === "--help" || cmd === "-h" || !cmd ? 0 : 1);
}

const { stack, results, notes, error } = init({ dir, dryRun });
if (error) {
  console.error(error);
  process.exit(1);
}

const langs = [stack.typescript ? "TypeScript" : stack.node ? "JavaScript" : null, stack.python ? "Python" : null].filter(Boolean);
console.log("Detected: " + langs.join(" + ") + (dryRun ? "  (dry run, nothing written)" : ""));
console.log("");
const label = {
  created: "created   ",
  suggested: "suggested ",
  "skipped-exists": "kept as-is",
  "would-be-created": "would create ",
  "would-be-suggested": "would suggest ",
};
for (const r of results) console.log("  " + (label[r.status] || r.status) + "  " + r.path);
if (results.some((r) => r.status === "suggested" || r.status === "would-be-suggested")) {
  console.log("\nFiles marked suggested already existed. Yours were left untouched; review the .suggested copies and merge what you want.");
}
if (notes.length) {
  console.log("\nHeads up:");
  for (const n of notes) console.log("  - " + n);
}
console.log("\nNext: pip install pre-commit && pre-commit install");
console.log("Note: this sets up a security baseline. It reduces common risks; it does not make your project secure on its own.");
