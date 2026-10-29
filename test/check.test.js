import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { check } from "../src/check.js";
import { formatReport } from "../src/report.js";
import { init } from "../src/init.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbc-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const ids = (r) => r.findings.map((f) => f.ruleId);

// Fake keys are assembled at runtime so this file itself never contains a real-looking secret.
const FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const FAKE_AI = "sk-" + "a1B2c3D4".repeat(5);

test("finds secrets and never prints their value", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  write(d, "src/config.js", `const a = "${FAKE_AWS}";\nconst b = "${FAKE_AI}";\n`);
  const r = check(d);
  assert.ok(ids(r).includes("secret-aws"));
  assert.ok(ids(r).includes("secret-ai-key"));
  const report = formatReport(r);
  assert.ok(!report.includes(FAKE_AWS));
  assert.ok(!report.includes(FAKE_AI));
  assert.ok(report.includes("src/config.js:1"));
});

test("generic secrets flagged, placeholders and env lookups are not", () => {
  const d = tmp();
  write(d, "a.js", 'const password = "hunter2hunter2hunter2";\n');
  write(d, "b.js", 'const apiKey = "your-api-key-goes-here";\nconst t = process.env.TOKEN;\n');
  const r = check(d);
  const hits = r.findings.filter((f) => f.ruleId === "secret-generic");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "a.js");
});

test("local .env files are not scanned for secrets", () => {
  const d = tmp();
  write(d, ".env", `AWS_KEY=${FAKE_AWS}\n`);
  assert.ok(!ids(check(d)).includes("secret-aws"));
});

test("detects risky JavaScript patterns", () => {
  const d = tmp();
  write(d, "app.js", [
    "eval(userInput);",
    "el.innerHTML = name;",
    "const agent = { rejectUnauthorized: false };",
    "app.use(cors({ origin: '*' }));",
    "db.query(`SELECT * FROM users WHERE id = ${id}`);",
  ].join("\n"));
  const got = ids(check(d));
  for (const id of ["js-eval", "js-inner-html", "js-tls-off", "js-cors-wildcard", "sql-concat"]) assert.ok(got.includes(id), id);
});

test("detects risky Python patterns", () => {
  const d = tmp();
  write(d, "app.py", [
    "import subprocess, yaml, pickle, requests",
    "subprocess.run(cmd, shell=True)",
    "yaml.load(f)",
    "pickle.loads(data)",
    "requests.get(url, verify=False)",
    "DEBUG = True",
    'cur.execute(f"SELECT * FROM t WHERE id = {x}")',
  ].join("\n"));
  const got = ids(check(d));
  for (const id of ["py-shell-true", "py-yaml-load", "py-pickle", "py-verify-false", "py-debug-true", "sql-concat"]) assert.ok(got.includes(id), id);
});

test("safe Python equivalents are not flagged", () => {
  const d = tmp();
  write(d, "ok.py", [
    "import ast, yaml",
    "ast.literal_eval(s)",
    "yaml.safe_load(f)",
    "yaml.load(f, Loader=yaml.SafeLoader)",
    "re.compile(p).exec_(x)",
  ].join("\n"));
  assert.deepEqual(ids(check(d)).filter((i) => i.startsWith("py-")), []);
});

test("comment lines and ignore marker suppress code findings", () => {
  const d = tmp();
  write(d, "x.js", ["// eval(old);", "eval(ok); // secure-baseline-ignore"].join("\n"));
  assert.ok(!ids(check(d)).includes("js-eval"));
});

test("Dockerfile problems: root, latest tag, secrets, copied .env", () => {
  const d = tmp();
  write(d, "Dockerfile", ["FROM node", "ENV API_KEY=abc123abc123", "COPY .env /app/.env", "ADD https://x.io/a.sh /a.sh"].join("\n"));
  const got = ids(check(d));
  for (const id of ["docker-root", "docker-latest", "docker-secret-env", "docker-copy-env", "docker-add-url", "dockerignore-missing"]) assert.ok(got.includes(id), id);
});

test("good multi-stage Dockerfile passes Docker checks", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  init({ dir: d });
  const got = ids(check(d));
  for (const id of ["docker-root", "docker-latest", "docker-secret-env", "docker-copy-env", "dockerignore-missing", "precommit-missing", "ci-missing", "agent-rules-missing"]) {
    assert.ok(!got.includes(id), "should not report " + id);
  }
});

test("committed .env is reported as high", (t) => {
  const d = tmp();
  try {
    execFileSync("git", ["init", "-q", d]);
  } catch {
    return t.skip("git not available");
  }
  write(d, ".env", "X=1\n");
  execFileSync("git", ["-C", d, "add", ".env"]);
  const r = check(d);
  const f = r.findings.find((x) => x.ruleId === "env-committed");
  assert.ok(f && f.severity === "high");
});

test("env file present but not gitignored is flagged", () => {
  const d = tmp();
  write(d, ".env", "X=1\n");
  write(d, ".gitignore", "node_modules\n");
  assert.ok(ids(check(d)).includes("env-not-ignored"));
  write(d, ".gitignore", "node_modules\n.env\n");
  assert.ok(!ids(check(d)).includes("env-not-ignored"));
});

test(".secure-baselineignore excludes folders from scanning", () => {
  const d = tmp();
  write(d, "src/a.js", "eval(x);\n");
  write(d, "fixtures/b.js", "eval(y);\n");
  write(d, ".secure-baselineignore", "# test data\nfixtures/\n");
  const hits = check(d).findings.filter((f) => f.ruleId === "js-eval");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "src/a.js");
});
