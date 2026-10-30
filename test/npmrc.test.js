import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { check } from "../src/check.js";
import { formatReport } from "../src/report.js";
import { init } from "../src/init.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbn-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const ids = (r) => r.findings.map((f) => f.ruleId);

// Assembled at runtime so no scanner sees a literal token in this file
const FAKE_TOKEN = "npm_" + "aB3dE5fG7h".repeat(3) + "abcdef";
const npmrc = (token) => `//registry.npmjs.org/:_authToken=${token}\n`;

test("a real-looking token in an unignored .npmrc is flagged high, and never printed", () => {
  const d = tmp();
  write(d, ".npmrc", npmrc(FAKE_TOKEN));
  const r = check(d);
  const f = r.findings.find((x) => x.ruleId === "npmrc-token-unignored");
  assert.ok(f && f.severity === "high" && f.file === ".npmrc" && f.line === 1);
  assert.ok(!formatReport(r).includes(FAKE_TOKEN));
});

test("covered by .gitignore: not flagged", () => {
  const d = tmp();
  write(d, ".npmrc", npmrc(FAKE_TOKEN));
  write(d, ".gitignore", "node_modules\n.npmrc\n");
  assert.ok(!ids(check(d)).includes("npmrc-token-unignored"));
});

test("placeholders and environment variable references are fine", () => {
  const d = tmp();
  write(d, ".npmrc", npmrc("YOUR_NEW_TOKEN_HERE"));
  write(d, "sub/.npmrc", npmrc("${NPM_TOKEN}"));
  const got = ids(check(d));
  assert.ok(!got.includes("npmrc-token-unignored") && !got.includes("npm-token-committed"));
});

test("an .npmrc that git tracks is reported as committed", (t) => {
  const d = tmp();
  try {
    execFileSync("git", ["init", "-q", d]);
  } catch {
    return t.skip("git not available");
  }
  write(d, ".npmrc", npmrc(FAKE_TOKEN));
  execFileSync("git", ["-C", d, "add", ".npmrc"]);
  assert.ok(ids(check(d)).includes("npm-token-committed"));
});

test("in a git repo, an ignored .npmrc is not flagged", (t) => {
  const d = tmp();
  try {
    execFileSync("git", ["init", "-q", d]);
  } catch {
    return t.skip("git not available");
  }
  write(d, ".npmrc", npmrc(FAKE_TOKEN));
  write(d, ".gitignore", ".npmrc\n");
  const got = ids(check(d));
  assert.ok(!got.includes("npmrc-token-unignored") && !got.includes("npm-token-committed"));
});

test("an npm token pasted into a code file is flagged", () => {
  const d = tmp();
  write(d, "publish.js", `const token = "${FAKE_TOKEN}";\n`);
  assert.ok(ids(check(d)).includes("npm-token-committed"));
});

test("init warns before the user commits an unignored token", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  write(d, ".npmrc", npmrc(FAKE_TOKEN));
  assert.ok(init({ dir: d }).notes.some((n) => n.includes(".npmrc")));

  const e = tmp();
  write(e, "package.json", "{}");
  write(e, ".npmrc", npmrc(FAKE_TOKEN));
  write(e, ".gitignore", ".env\n.npmrc\n");
  assert.ok(!init({ dir: e }).notes.some((n) => n.includes(".npmrc")));
});
