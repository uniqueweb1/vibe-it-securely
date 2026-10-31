#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/init.js";
import { check } from "../src/check.js";
import { checkDependencies } from "../src/deps.js";
import { renderHtml, openInBrowser } from "../src/html-report.js";
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
  vibe-it-securely init  [--dir <path>] [--dry-run] [--stack js|ts|python] [--docker]
  vibe-it-securely check [--dir <path>] [--fail-on high|medium|none] [--json] [--online]
  vibe-it-securely report [--dir <path>] [--online] [--out <file>] [--no-open]

init   Generates pre-commit hooks, CI checks and AI-assistant rules. Existing files
       are never overwritten; new versions are saved as <name>.suggested for you to
       review. Starting a brand-new project in an empty folder? Add --stack ts,
       --stack js or --stack python. Add --docker to also generate Dockerfiles.
check  Looks for leaked secrets, risky code patterns, Docker problems and missing
       safeguards, and explains each finding in plain language.
       --online also verifies that every dependency name really exists on npm/PyPI
       (AI tools sometimes invent package names). It contacts the public registries.
       Exit code 1 if anything at or above --fail-on is found (default: high).
report Same checks, shown as an easy-to-read web page that opens in your browser,
       with buttons that copy a ready-made fix request for your AI assistant.
       Saved in your temp folder unless you pass --out <file>.`;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (["init", "check", "report"].includes(cmd)) {
  let isFolder = false;
  try {
    isFolder = fs.statSync(dir).isDirectory();
  } catch {
    /* not found */
  }
  if (!isFolder) {
    console.error(`Folder not found: ${dir}`);
    console.error("Use the real path of your project, or open a terminal inside your project folder and leave out --dir.");
    process.exit(1);
  }
}

if (cmd === "init") {
  const dryRun = flag("--dry-run");
  const stackFlag = flag("--stack") ? (value("--stack") && !value("--stack").startsWith("--") ? value("--stack") : "") : undefined;
  const { stack, projects, results, notes, error, docker } = init({ dir, dryRun, docker: flag("--docker") && !flag("--no-docker"), stackFlag });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const describe = (s) => [s.typescript ? "TypeScript" : s.node ? "JavaScript" : null, s.python ? "Python" : null].filter(Boolean).join(" + ");
  const suffix = dryRun ? "  (dry run, nothing written)" : "";
  if (projects.length === 1 && projects[0].virtual) {
    console.log("New project: " + describe(stack) + " (from --stack, no project files yet)" + suffix);
  } else if (projects.length === 1 && projects[0].path === "") {
    console.log("Detected: " + describe(stack) + suffix);
  } else {
    console.log(`Detected ${projects.length} ${projects.length === 1 ? "project" : "projects"}${suffix}:`);
    for (const p of projects) console.log("  " + (p.path || ".") + ": " + describe(p.stack));
  }
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
  if (!docker) console.log("\nDocker files were not created. Add --docker if you want them.");
  console.log("\nNext: git init (if you have not yet), pip install pre-commit && pre-commit install, then run: vibe-it-securely report");
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
} else if (cmd === "report") {
  const result = check(dir);
  result.notes = [];
  if (flag("--online")) {
    const dep = await checkDependencies(dir);
    result.findings.push(...dep.findings);
    result.notes.push(`Checked ${dep.checked} dependency names against npm/PyPI.` + (dep.unverified ? ` ${dep.unverified} could not be verified (network problem or private registry).` : ""));
  }
  const html = renderHtml(result, { projectName: path.basename(dir) });
  const out = value("--out") ? path.resolve(value("--out")) : path.join(os.tmpdir(), `vibe-it-securely-report-${Date.now()}.html`);
  fs.writeFileSync(out, html);

  const c = countBySeverity(result.findings);
  console.log(`Scanned ${result.filesScanned} files: ${c.high} to fix first, ${c.medium} should fix, ${c.info} ${c.info === 1 ? "suggestion" : "suggestions"}.`);
  console.log("Report saved to: " + out);
  if (!flag("--no-open")) {
    const opened = await openInBrowser(out);
    console.log(opened ? "Opening it in your browser..." : "Could not open a browser automatically. Open the file above by double-clicking it.");
  }
} else {
  console.log(HELP);
  process.exit(1);
}
