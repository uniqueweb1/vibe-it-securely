import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/init.js";
import { check } from "../src/check.js";
import { parseStackFlag } from "../src/detect.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbp-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const has = (d, f) => fs.existsSync(path.join(d, f));

test("parseStackFlag understands common spellings and rejects nonsense", () => {
  assert.deepEqual(
    [parseStackFlag("ts").stack.typescript, parseStackFlag("TypeScript").stack.node, parseStackFlag("py").stack.python, parseStackFlag("ts,python").stack.python],
    [true, true, true, true],
  );
  assert.deepEqual(parseStackFlag("ruby").bad, ["ruby"]);
  assert.equal(parseStackFlag("").empty, true);
});

test("an empty folder without --stack explains how to start a new project", () => {
  const r = init({ dir: tmp() });
  assert.ok(r.error && r.error.includes("--stack"));
});

test("--stack ts works in an empty folder", () => {
  const d = tmp();
  const r = init({ dir: d, stackFlag: "ts" });
  assert.ok(!r.error);
  for (const f of [".pre-commit-config.yaml", ".github/workflows/security.yml", "AGENTS.md", ".env.example", ".gitleaksignore", ".gitignore"]) assert.ok(has(d, f), f);
  assert.ok(!has(d, "Dockerfile"), "Docker is opt-in");
  assert.ok(fs.readFileSync(path.join(d, "AGENTS.md"), "utf8").includes("JavaScript / TypeScript"));
  assert.ok(fs.readFileSync(path.join(d, ".github/workflows/security.yml"), "utf8").includes("npm audit"));
  assert.ok(r.notes.some((n) => n.includes("npm init -y")));
  assert.equal(r.projects[0].virtual, true);
});

test("--stack python and --stack ts,python", () => {
  const p = tmp();
  init({ dir: p, stackFlag: "python" });
  const ci = fs.readFileSync(path.join(p, ".github/workflows/security.yml"), "utf8");
  assert.ok(ci.includes("pip-audit -r requirements.txt") && !ci.includes("npm audit"));
  assert.ok(init({ dir: tmp(), stackFlag: "ts,python" }).stack.node);
});

test("--stack with --docker generates the Dockerfile for the chosen stack", () => {
  const d = tmp();
  init({ dir: d, stackFlag: "python", docker: true });
  assert.ok(fs.readFileSync(path.join(d, "Dockerfile"), "utf8").includes("python:3.12-slim"));
  assert.ok(has(d, ".dockerignore"));
});

test("an invalid --stack value is rejected before anything is written", () => {
  const d = tmp();
  const r = init({ dir: d, stackFlag: "cobol" });
  assert.ok(r.error);
  assert.ok(!has(d, "AGENTS.md"));
  assert.ok(init({ dir: d, stackFlag: "" }).error);
});

test("--stack is ignored when project files already exist", () => {
  const d = tmp();
  write(d, "requirements.txt", "flask\n");
  const r = init({ dir: d, stackFlag: "ts" });
  assert.equal(r.stack.python, true);
  assert.equal(r.stack.node, false);
  assert.ok(r.notes.some((n) => n.includes("--stack was ignored")));
});

test("a brand-new project passes check right after init (no leftover findings)", () => {
  const d = tmp();
  init({ dir: d, stackFlag: "ts" });
  assert.deepEqual(check(d).findings.map((f) => f.ruleId), []);
});

test("dry run with --stack writes nothing", () => {
  const d = tmp();
  init({ dir: d, stackFlag: "js", dryRun: true });
  assert.ok(!has(d, "AGENTS.md"));
});
