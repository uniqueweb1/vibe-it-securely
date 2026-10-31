import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbc2-"));

test("a folder that does not exist is an error for every command, not an empty project", () => {
  for (const cmd of ["check", "report", "init"]) {
    const r = run(cmd, "--dir", "C:\\path\\to\\project", "--no-open");
    assert.equal(r.status, 1, cmd);
    assert.ok(r.stderr.includes("Folder not found"), cmd);
    assert.ok(!r.stdout.includes("No pre-commit hooks"), cmd + " must not report findings for a missing folder");
  }
});

test("a path that is a file, not a folder, is rejected too", () => {
  const f = path.join(tmp(), "file.txt");
  fs.writeFileSync(f, "x");
  assert.equal(run("check", "--dir", f).status, 1);
});

test("an existing but empty folder warns that nothing was scanned", () => {
  const r = run("check", "--dir", tmp(), "--fail-on", "none");
  assert.ok(r.stdout.includes("no files were scanned"));
});

test("the web report says so as well", () => {
  const out = path.join(tmp(), "r.html");
  run("report", "--dir", tmp(), "--out", out, "--no-open");
  assert.ok(fs.readFileSync(out, "utf8").includes("No files were scanned"));
});

test("a normal project does not get the warning", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "a.js"), "const x = 1;\n");
  assert.ok(!run("check", "--dir", d, "--fail-on", "none").stdout.includes("no files were scanned"));
});
