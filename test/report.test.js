import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderHtml, esc } from "../src/html-report.js";
import { RULES } from "../src/check.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbr-"));
const finding = (ruleId, file, line, detail) => ({ ruleId, severity: RULES[ruleId].severity, file, line, detail });

test("esc neutralises HTML", () => {
  assert.equal(esc('<a href="x">&\''), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("report escapes hostile file names and details", () => {
  const html = renderHtml({
    filesScanned: 3,
    findings: [finding("js-eval", '<img src=x onerror=alert(1)>.js', 4, '"><script>alert(2)</script>')],
  }, { projectName: "<b>proj</b>" });
  assert.ok(!html.includes("<img src=x onerror"));
  assert.ok(!html.includes("<script>alert(2)"));
  assert.ok(!html.includes("<b>proj</b>"));
  assert.ok(html.includes("&lt;img src=x onerror"));
});

test("report shows counts, plain-language sections and copy buttons", () => {
  const html = renderHtml({
    filesScanned: 10,
    findings: [finding("secret-aws", "a.js", 1), finding("js-eval", "b.js", 2), finding("js-eval", "c.js", 3), finding("agent-rules-missing")],
  });
  assert.ok(html.includes("1 problem needs fixing first"));
  assert.ok(html.includes("Fix these first") && html.includes("Should fix") && html.includes("Suggestions"));
  assert.ok(html.includes("<code>b.js:2</code>") && html.includes("<code>c.js:3</code>"));
  assert.equal((html.match(/data-prompt=/g) || []).length, 4); // 3 cards + 1 "copy all"
  assert.ok(html.includes("Copy one fix request for everything below"));
});

test("report hides extra locations behind a details element", () => {
  const many = Array.from({ length: 8 }, (_, i) => finding("js-eval", `f${i}.js`, i + 1));
  const html = renderHtml({ filesScanned: 8, findings: many });
  assert.ok(html.includes("Show 3 more"));
});

test("clean project gets an honest all-clear", () => {
  const html = renderHtml({ filesScanned: 5, findings: [] });
  assert.ok(html.includes("Nothing found by these checks"));
  assert.ok(html.includes("not a guarantee"));
  assert.ok(!html.includes("data-prompt="));
});

test("report command writes the page without opening a browser when asked", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "app.js"), "eval(x);\n");
  const out = path.join(tmp(), "r.html");
  const stdout = execFileSync(process.execPath, [CLI, "report", "--dir", d, "--out", out, "--no-open"], { encoding: "utf8" });
  assert.ok(stdout.includes("Report saved to:"));
  const html = fs.readFileSync(out, "utf8");
  assert.ok(html.includes("Security check") && html.includes("eval() runs text as code"));
});
