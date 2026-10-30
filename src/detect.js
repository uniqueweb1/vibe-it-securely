import fs from "node:fs";
import path from "node:path";

const has = (dir, f) => fs.existsSync(path.join(dir, f));

export function detectStack(dir) {
  const stack = {
    node: false,
    typescript: false,
    python: false,
    packageManager: null,
    hasNodeLock: false,
    pythonDeps: null, // requirements.txt | pyproject | pipfile | setup
  };

  if (has(dir, "package.json")) {
    stack.node = true;
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      /* malformed package.json: still treat as a Node project */
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    stack.typescript = has(dir, "tsconfig.json") || "typescript" in deps;
    stack.hasNodeLock = has(dir, "package-lock.json");
    stack.packageManager = has(dir, "pnpm-lock.yaml")
      ? "pnpm"
      : has(dir, "yarn.lock")
        ? "yarn"
        : "npm";
  }

  if (has(dir, "requirements.txt")) stack.pythonDeps = "requirements.txt";
  else if (has(dir, "pyproject.toml")) stack.pythonDeps = "pyproject";
  else if (has(dir, "Pipfile")) stack.pythonDeps = "pipfile";
  else if (has(dir, "setup.py")) stack.pythonDeps = "setup";
  stack.python = stack.pythonDeps !== null;

  return stack;
}

// Folders that never hold the project's own manifests
const SKIP = new Set([
  ".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", ".next", ".nuxt",
  "coverage", ".tox", ".mypy_cache", ".pytest_cache", "vendor", ".idea", ".vscode",
  "test", "tests", "__tests__", "fixtures", "__mocks__", "mocks", "examples",
]);
const MAX_PROJECTS = 12;

/**
 * Finds every JS/TS/Python project in this folder and up to `maxDepth` levels of subfolders,
 * so monorepos (for example frontend/ + backend/) are understood.
 * Returns { projects: [{ path, stack }], stack } where path is "" for the root folder
 * and stack is a merged summary of everything found.
 */
export function detectWorkspace(dir, maxDepth = 3) {
  const projects = [];
  const visit = (rel, depth) => {
    if (projects.length >= MAX_PROJECTS) return;
    const abs = path.join(dir, rel);
    const stack = detectStack(abs);
    if (stack.node || stack.python) projects.push({ path: rel, stack });
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) {
        visit(rel ? rel + "/" + e.name : e.name, depth + 1);
      }
    }
  };
  visit("", 0);

  const firstNode = projects.find((p) => p.stack.node);
  const firstPy = projects.find((p) => p.stack.python);
  const stack = {
    node: Boolean(firstNode),
    typescript: projects.some((p) => p.stack.typescript),
    python: Boolean(firstPy),
    packageManager: firstNode ? firstNode.stack.packageManager : null,
    hasNodeLock: firstNode ? firstNode.stack.hasNodeLock : false,
    pythonDeps: firstPy ? firstPy.stack.pythonDeps : null,
  };
  return { projects, stack };
}
