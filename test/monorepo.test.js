import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectWorkspace } from "../src/detect.js";
import { init } from "../src/init.js";
import { check } from "../src/check.js";
import { checkDependencies } from "../src/deps.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbm-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const ids = (r) => r.findings.map((f) => f.ruleId);

/** frontend/ (TypeScript) + backend/ (Python), nothing in the root */
function monorepo() {
  const d = tmp();
  write(d, "frontend/package.json", JSON.stringify({ devDependencies: { typescript: "5" }, dependencies: { react: "18" } }));
  write(d, "backend/requirements.txt", "fastapi\nuvicorn\n");
  return d;
}

test("finds projects in subfolders and ignores junk folders", () => {
  const d = monorepo();
  write(d, "frontend/node_modules/leftpad/package.json", "{}");
  write(d, "backend/.venv/lib/requirements.txt", "x\n");
  write(d, "backend/tests/fixtures/package.json", "{}");
  const { projects, stack } = detectWorkspace(d);
  assert.deepEqual(projects.map((p) => p.path), ["backend", "frontend"]);
  assert.equal(stack.node && stack.python && stack.typescript, true);
});

test("a single root project is still reported with path ''", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  assert.deepEqual(detectWorkspace(d).projects.map((p) => p.path), [""]);
});

test("init works from the repository root and puts files where they belong", () => {
  const d = monorepo();
  const r = init({ dir: d, docker: true });
  assert.ok(!r.error);
  for (const f of [".pre-commit-config.yaml", ".github/workflows/security.yml", "AGENTS.md", "frontend/Dockerfile", "frontend/.dockerignore", "backend/Dockerfile", "backend/.dockerignore"]) {
    assert.ok(fs.existsSync(path.join(d, f)), f + " missing");
  }
  assert.ok(!fs.existsSync(path.join(d, "Dockerfile")), "no Dockerfile at the root");
  const ci = fs.readFileSync(path.join(d, ".github/workflows/security.yml"), "utf8");
  assert.ok(ci.includes("working-directory: frontend") && ci.includes("working-directory: backend"));
  assert.ok(ci.includes("pip-audit -r requirements.txt"));
  assert.ok(fs.readFileSync(path.join(d, "backend/Dockerfile"), "utf8").includes("python:3.12-slim"));
  assert.ok(fs.readFileSync(path.join(d, "frontend/Dockerfile"), "utf8").includes("node:22-slim"));
});

test("init skips container files in every project unless --docker is given", () => {
  const d = monorepo();
  init({ dir: d });
  assert.ok(!fs.existsSync(path.join(d, "frontend/Dockerfile")));
  assert.ok(!fs.existsSync(path.join(d, "backend/Dockerfile")));
});

test("init on a folder with no project anywhere explains where it looked", () => {
  const r = init({ dir: tmp() });
  assert.ok(r.error && r.error.includes("subfolders"));
});

test("lockfile check runs per project and points at the right file", () => {
  const d = monorepo();
  assert.deepEqual(check(d).findings.filter((f) => f.ruleId === "lockfile-missing").map((f) => f.file), ["frontend/package.json"]);
  write(d, "frontend/package-lock.json", "{}");
  assert.ok(!ids(check(d)).includes("lockfile-missing"));
});

test("dependency check covers every project and looks each package up once", async () => {
  const d = monorepo();
  write(d, "frontend/package.json", JSON.stringify({ dependencies: { react: "18", "made-up-ui-lib": "1" } }));
  write(d, "backend/requirements.txt", "fastapi\nmade_up_api_pkg==1\n");
  write(d, "other/package.json", JSON.stringify({ dependencies: { react: "18" } }));
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { status: /made-up/.test(url) ? 404 : 200, ok: !/made-up/.test(url) };
  };
  const r = await checkDependencies(d, { fetchImpl });
  assert.deepEqual(r.findings.map((f) => `${f.file}: ${f.detail}`).sort(), [
    "backend/requirements.txt: made-up-api-pkg on PyPI",
    "frontend/package.json: made-up-ui-lib on npm",
  ]);
  assert.equal(seen.filter((u) => u.endsWith("/react")).length, 1);
  assert.equal(r.checked, 5); // every use is counted, but react is only fetched once
});

test("Supabase is detected from a subfolder's package.json", () => {
  const d = tmp();
  write(d, "frontend/package.json", JSON.stringify({ dependencies: { "@supabase/supabase-js": "2" } }));
  write(d, "db/schema.sql", "create table public.todos (id int);\n");
  assert.ok(ids(check(d)).includes("sql-rls-missing"));
});
