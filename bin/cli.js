#!/usr/bin/env node
import path from "node:path";
import { init } from "../src/init.js";
import { check } from "../src/check.js";
import { checkDependencies } from "../src/deps.js";
import { formatReport, countBySeverity } from "../src/report.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = path.resolve(value("--dir") || process.cwd());

const HELP = `vibe-it-securely - a security baseline for your project

Usage:
  vibe-it-securely init  [--dir <path>] [--dry-run] [--no-docker]
  vibe-it-securely check [--dir <path>] [--fail-on high|medium|none] [--json] [--online]

init   Generates pre-commit hooks, CI checks, hardened Docker files and AI-assistant
       rules. Existing files are never overwritten; new versions are saved as
       <name>.suggested for you to review. Use --no-docker for libraries, CLIs
       and scripts that do not ship as a container.
check  Looks for leaked secrets, risky code patterns, Docker problems and missing
       safeguards, and explains each finding in plain language.
       --online also verifies that every dependency name really exists on npm/PyPI
       (AI tools sometimes invent package names). It contacts the public registries.
       Exit code 1 if anything at or above --fail-on is found (default: high).`;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (cmd === "init") {
  const dryRun = flag("--dry-run");
  const { stack, results, notes, error } = init({ dir, dryRun, docker: !flag("--no-docker") });
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
  console.log("\nNext: pip install pre-commit && pre-commit install, then run: vibe-it-securely check");
  console.log("Note: this sets up a security baseline. It reduces common risks; it does not make your project secure on its own.");
} else if (cmd === "check") {
  const failOn = value("--fail-on") || "high";
  if (!["high", "medium", "none"].includes(failOn)) {
    console.error("--fail-on must be high, medium or none");
    process.exit(1);
  }
  const result = check(dir);
  result.notes = [];
  if (flag("--online")) {
    const dep = await checkDependencies(dir);
    result.findings.push(...dep.findings);
    result.notes.push(`Checked ${dep.checked} dependency names against npm/PyPI.` + (dep.unverified ? ` ${dep.unverified} could not be verified (network problem or private registry).` : ""));
  }
  if (flag("--json")) console.log(JSON.stringify({ findings: result.findings, filesScanned: result.filesScanned, notes: result.notes }, null, 2));
  else console.log(formatReport(result));
  const c = countBySeverity(result.findings);
  const fail = failOn === "high" ? c.high > 0 : failOn === "medium" ? c.high + c.medium > 0 : false;
  process.exit(fail ? 1 : 0);
} else {
  console.log(HELP);
  process.exit(1);
}
