import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectStack } from "../src/detect.js";
import { init } from "../src/init.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
const write = (d, f, c = "") => fs.writeFileSync(path.join(d, f), c);

test("detects TypeScript + npm", () => {
  const d = tmp();
  write(d, "package.json", JSON.stringify({ devDependencies: { typescript: "5" } }));
  write(d, "package-lock.json", "{}");
  const s = detectStack(d);
  assert.equal(s.node, true);
  assert.equal(s.typescript, true);
  assert.equal(s.packageManager, "npm");
  assert.equal(s.hasNodeLock, true);
});

test("detects Python via requirements.txt", () => {
  const d = tmp();
  write(d, "requirements.txt", "flask\n");
  assert.equal(detectStack(d).pythonDeps, "requirements.txt");
});

test("empty folder is rejected", () => {
  assert.ok(init({ dir: tmp() }).error);
});

test("init creates baseline files for a Node project", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  const { results } = init({ dir: d });
  for (const f of [".pre-commit-config.yaml", ".github/workflows/security.yml", "Dockerfile", ".dockerignore", "AGENTS.md", ".env.example", ".gitignore"]) {
    assert.ok(fs.existsSync(path.join(d, f)), f + " missing");
  }
  assert.ok(results.every((r) => r.status === "created"));
});

test("mixed project gets two Dockerfiles", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  write(d, "requirements.txt", "flask\n");
  init({ dir: d });
  assert.ok(fs.existsSync(path.join(d, "Dockerfile.node")));
  assert.ok(fs.existsSync(path.join(d, "Dockerfile.python")));
});

test("never overwrites existing files; writes .suggested instead", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  write(d, "Dockerfile", "MY OWN DOCKERFILE");
  const { results } = init({ dir: d });
  assert.equal(fs.readFileSync(path.join(d, "Dockerfile"), "utf8"), "MY OWN DOCKERFILE");
  assert.ok(fs.existsSync(path.join(d, "Dockerfile.suggested")));
  assert.ok(results.find((r) => r.path === "Dockerfile.suggested"));
});

test("running twice changes nothing the second time", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  init({ dir: d });
  const before = fs.readFileSync(path.join(d, "AGENTS.md"), "utf8");
  init({ dir: d });
  assert.equal(fs.readFileSync(path.join(d, "AGENTS.md"), "utf8"), before);
});

test("warns when .gitignore does not cover .env", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  write(d, ".gitignore", "node_modules\n");
  const { notes } = init({ dir: d });
  assert.ok(notes.some((n) => n.includes(".env")));
});

test("dry run writes nothing", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  init({ dir: d, dryRun: true });
  assert.ok(!fs.existsSync(path.join(d, "AGENTS.md")));
});

test("--no-docker skips container files", () => {
  const d = tmp();
  write(d, "package.json", "{}");
  init({ dir: d, docker: false });
  assert.ok(!fs.existsSync(path.join(d, "Dockerfile")));
  assert.ok(!fs.existsSync(path.join(d, ".dockerignore")));
  assert.ok(fs.existsSync(path.join(d, ".pre-commit-config.yaml")));
});
