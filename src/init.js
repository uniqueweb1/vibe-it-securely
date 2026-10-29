import fs from "node:fs";
import path from "node:path";
import { detectStack } from "./detect.js";
import { safeWrite } from "./safe-write.js";
import * as t from "./templates.js";

export function init({ dir, dryRun = false, docker = true }) {
  const stack = detectStack(dir);
  if (!stack.node && !stack.python) {
    return { stack, results: [], notes: [], error: "No supported project found (looked for package.json, requirements.txt, pyproject.toml, Pipfile, setup.py)." };
  }

  const files = [
    { path: ".pre-commit-config.yaml", content: t.preCommit() },
    { path: ".github/workflows/security.yml", content: t.ciWorkflow(stack) },
    { path: "AGENTS.md", content: t.agentRules(stack) },
  ];

  if (!docker) {
    // libraries, CLIs and scripts do not need container files
  } else if (stack.node && stack.python) {
    files.push(
      { path: ".dockerignore", content: t.dockerignore() },
    );
    files.push({ path: "Dockerfile.node", content: t.dockerfileNode(stack) });
    files.push({ path: "Dockerfile.python", content: t.dockerfilePython(stack) });
  } else if (stack.node) {
    files.push({ path: ".dockerignore", content: t.dockerignore() });
    files.push({ path: "Dockerfile", content: t.dockerfileNode(stack) });
  } else {
    files.push({ path: ".dockerignore", content: t.dockerignore() });
    files.push({ path: "Dockerfile", content: t.dockerfilePython(stack) });
  }

  const results = files.map((f) => safeWrite(dir, f.path, f.content, { dryRun }));
  // Quiet extras: only create if missing, never write .suggested copies
  results.push(safeWrite(dir, ".env.example", t.envExample(), { dryRun, onExists: "skip" }));

  const notes = [];
  const giPath = path.join(dir, ".gitignore");
  if (!fs.existsSync(giPath)) {
    results.push(safeWrite(dir, ".gitignore", t.gitignore(), { dryRun }));
  } else {
    const lines = fs.readFileSync(giPath, "utf8").split(/\r?\n/).map((l) => l.trim());
    if (!lines.some((l) => l === ".env" || l === ".env*" || l === "*.env")) {
      notes.push("Your .gitignore does not ignore .env files. Anyone who creates a .env could accidentally commit their secrets. Add a line containing: .env");
    }
  }
  if (stack.node && !stack.hasNodeLock && stack.packageManager === "npm") {
    notes.push("No package-lock.json found. Commit one so installs are reproducible and dependency audits are accurate.");
  }

  return { stack, results, notes };
}
