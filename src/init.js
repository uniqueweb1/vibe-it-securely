import fs from "node:fs";
import path from "node:path";
import { detectWorkspace, parseStackFlag } from "./detect.js";
import { safeWrite } from "./safe-write.js";
import * as t from "./templates.js";

const NO_PROJECT =
  "No supported project found (looked in this folder and up to 3 levels of subfolders for package.json, requirements.txt, pyproject.toml, Pipfile, setup.py). " +
  "Starting a brand-new project in an empty folder? Tell it what you are building: --stack ts, --stack js or --stack python.";

/**
 * docker:    also generate Dockerfiles (off by default; most new projects do not need them yet)
 * stackFlag: "js" | "ts" | "python" (comma separated). Only used when no project files exist yet.
 */
export function init({ dir, dryRun = false, docker = false, stackFlag } = {}) {
  let { projects, stack } = detectWorkspace(dir);
  const notes = [];

  if (stackFlag !== undefined) {
    const parsed = parseStackFlag(stackFlag);
    if (parsed.bad.length || parsed.empty) {
      return { stack, projects, results: [], notes, error: "Unknown --stack value. Use js, ts or python (for example --stack ts, or --stack ts,python)." };
    }
    if (!projects.length) {
      projects = [{ path: "", stack: parsed.stack, virtual: true }];
      stack = parsed.stack;
      const files = [parsed.stack.node ? "package.json (run: npm init -y)" : null, parsed.stack.python ? "requirements.txt" : null].filter(Boolean);
      notes.push(`No project files exist yet, so this was set up from --stack. Create ${files.join(" and ")} so the CI dependency checks have something to audit.`);
    } else {
      notes.push("Project files were found, so --stack was ignored.");
    }
  }

  if (!projects.length) return { stack, projects, results: [], notes, error: NO_PROJECT };

  // Repository-wide files live at the root
  const files = [
    { path: ".pre-commit-config.yaml", content: t.preCommit() },
    { path: ".github/workflows/security.yml", content: t.ciWorkflow(projects) },
    { path: "AGENTS.md", content: t.agentRules(stack) },
  ];

  // Container files live next to each project, only when asked for with --docker
  if (docker) {
    for (const p of projects) {
      const prefix = p.path ? p.path + "/" : "";
      files.push({ path: prefix + ".dockerignore", content: t.dockerignore() });
      if (p.stack.node && p.stack.python) {
        files.push({ path: prefix + "Dockerfile.node", content: t.dockerfileNode(p.stack) });
        files.push({ path: prefix + "Dockerfile.python", content: t.dockerfilePython(p.stack) });
      } else if (p.stack.node) {
        files.push({ path: prefix + "Dockerfile", content: t.dockerfileNode(p.stack) });
      } else {
        files.push({ path: prefix + "Dockerfile", content: t.dockerfilePython(p.stack) });
      }
    }
  }

  const results = files.map((f) => safeWrite(dir, f.path, f.content, { dryRun }));
  // Quiet extras: only create if missing, never write .suggested copies
  results.push(safeWrite(dir, ".env.example", t.envExample(), { dryRun, onExists: "skip" }));
  results.push(safeWrite(dir, ".gitleaksignore", t.gitleaksIgnore(), { dryRun, onExists: "skip" }));

  const giPath = path.join(dir, ".gitignore");
  if (!fs.existsSync(giPath)) {
    results.push(safeWrite(dir, ".gitignore", t.gitignore(), { dryRun }));
  } else {
    const lines = fs.readFileSync(giPath, "utf8").split(/\r?\n/).map((l) => l.trim());
    if (!lines.some((l) => l === ".env" || l === ".env*" || l === "*.env")) {
      notes.push("Your .gitignore does not ignore .env files. Anyone who creates a .env could accidentally commit their secrets. Add a line containing: .env");
    }
  }
  for (const p of projects) {
    if (!p.virtual && p.stack.node && !p.stack.hasNodeLock && p.stack.packageManager === "npm") {
      notes.push(`No package-lock.json found in ${p.path || "the project folder"}. Commit one so installs are reproducible and dependency audits are accurate.`);
    }
  }

  const npmrcPath = path.join(dir, ".npmrc");
  if (fs.existsSync(npmrcPath)) {
    const m = fs.readFileSync(npmrcPath, "utf8").match(/_authToken\s*=\s*(\S+)/);
    const real = m && !m[1].startsWith("${") && m[1].length >= 8 && !/(your|example|change.?me|placeholder|dummy|sample|xxxx|todo)/i.test(m[1]);
    let ignored = false;
    try {
      ignored = fs.readFileSync(giPath, "utf8").split(/\r?\n/).some((l) => /^\/?\.npmrc$/.test(l.trim()));
    } catch {
      /* no .gitignore */
    }
    if (real && !ignored) {
      notes.push("Your .npmrc contains an npm login token and is not in .gitignore. Add .npmrc to .gitignore before you commit, or the token will be published.");
    }
  }

  return { stack, projects, results, notes, docker };
}
