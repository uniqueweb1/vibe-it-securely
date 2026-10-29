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
