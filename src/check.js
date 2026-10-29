import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { detectStack } from "./detect.js";
import { lineSecretRule, checkRoutes, analyzeSql, detectSupabase, PUBLIC_ENV } from "./vibe.js";

/**
 * Every rule carries its own plain-language explanation, so findings are
 * understandable without looking anything up.
 * severity: "high" = fix now, "medium" = should fix, "info" = suggestion
 */
export const RULES = {
  // ---------- Secrets ----------
  "secret-private-key": {
    severity: "high",
    title: "A private key is stored in a project file",
    why: "Anyone who can read this code (or the git history) can impersonate you or your server.",
    fix: "Remove the file from the project, add it to .gitignore, and generate a new key. Treat the old key as stolen.",
  },
  "secret-aws": {
    severity: "high",
    title: "Looks like an AWS access key",
    why: "Leaked cloud keys are found by bots within minutes and used to run up bills or steal data.",
    fix: "Revoke the key in your AWS console now, create a new one, and load it from an environment variable.",
  },
  "secret-github": {
    severity: "high",
    title: "Looks like a GitHub access token",
    why: "Anyone with this token can read or change your repositories.",
    fix: "Revoke the token in GitHub settings, create a new one, and load it from an environment variable.",
  },
  "secret-slack": {
    severity: "high",
    title: "Looks like a Slack token",
    why: "Anyone with this token can read or post in your Slack workspace.",
    fix: "Revoke the token in Slack, create a new one, and load it from an environment variable.",
  },
  "secret-ai-key": {
    severity: "high",
    title: "Looks like an AI provider API key (OpenAI, Anthropic, etc.)",
    why: "Leaked AI keys get abused quickly and you pay for whatever others run with them.",
    fix: "Revoke the key in the provider dashboard, create a new one, and load it from an environment variable.",
  },
  "secret-generic": {
    severity: "medium",
    title: "A password, token or key may be written directly in the code",
    why: "Secrets in code end up in git history and are visible to anyone with access to the repository.",
    fix: "Move the value to an environment variable (e.g. process.env.X or os.environ[\"X\"]). If it was real, change it. If it is a harmless example, add the comment vibe-it-securely-ignore on that line.",
  },
  "env-committed": {
    severity: "high",
    title: "A .env file is tracked by git",
    why: ".env files usually hold real passwords and keys. Once committed, they stay in history even if you delete the file later.",
    fix: "Run: git rm --cached .env, add .env to .gitignore, and change every secret that was in the file.",
  },
  "env-not-ignored": {
    severity: "medium",
    title: ".gitignore does not exclude .env files",
    why: "The next git add . could publish your secrets.",
    fix: "Add these lines to .gitignore: .env and .env.*  (and !.env.example to keep the template).",
  },

  // ---------- Risky code: JavaScript / TypeScript ----------
  "js-eval": {
    severity: "medium",
    title: "eval() runs text as code",
    why: "If any part of that text comes from a user, they can run their own code on your app.",
    fix: "Replace eval with JSON.parse for data, or a lookup table / function for logic.",
  },
  "js-new-function": {
    severity: "medium",
    title: "new Function() builds code from text",
    why: "It has the same risk as eval: user-controlled text becomes running code.",
    fix: "Use normal functions or a lookup table instead.",
  },
  "js-inner-html": {
    severity: "medium",
    title: "Raw HTML is inserted into the page",
    why: "If the HTML contains user input, attackers can inject scripts (cross-site scripting) and steal sessions.",
    fix: "Use textContent or normal React rendering. If you truly need HTML, sanitize it first (e.g. DOMPurify).",
  },
  "js-exec-template": {
    severity: "medium",
    title: "A shell command is built from a text template",
    why: "If user input reaches the command, an attacker can run any command on your server.",
    fix: "Use execFile or spawn with an argument array instead of one command string.",
  },
  "js-tls-off": {
    severity: "high",
    title: "HTTPS certificate checking is turned off",
    why: "Without certificate checks, anyone on the network path can read or change traffic.",
    fix: "Remove this setting. If you hit a certificate error, fix the certificate rather than disabling the check.",
  },
  "js-cors-wildcard": {
    severity: "medium",
    title: "CORS allows every website (origin: \"*\")",
    why: "Any website can call your API from a visitor's browser, which is dangerous if the API uses cookies or private data.",
    fix: "List your real front-end addresses explicitly, e.g. origin: [\"https://myapp.com\"].",
  },

  // ---------- Risky code: both ----------
  "sql-concat": {
    severity: "medium",
    title: "A database query is built by joining text",
    why: "If user input ends up in the query, attackers can read or delete your data (SQL injection).",
    fix: "Use parameterized queries (placeholders like ? or $1 / %s) or an ORM, and pass values separately.",
  },

  // ---------- Risky code: Python ----------
  "py-eval-exec": {
    severity: "medium",
    title: "eval() / exec() runs text as code",
    why: "If any part of that text comes from a user, they can run their own code on your app.",
    fix: "Use ast.literal_eval for simple data, json.loads for JSON, or explicit logic.",
  },
  "py-shell-true": {
    severity: "medium",
    title: "subprocess is run through the shell (shell=True)",
    why: "If user input reaches the command, an attacker can run any command on your server.",
    fix: "Pass the command as a list, e.g. subprocess.run([\"ls\", path]), without shell=True.",
  },
  "py-yaml-load": {
    severity: "medium",
    title: "yaml.load() can execute code from the YAML file",
    why: "A crafted YAML file can run arbitrary code when loaded this way.",
    fix: "Use yaml.safe_load instead.",
  },
  "py-pickle": {
    severity: "medium",
    title: "pickle can execute code when loading data",
    why: "Loading a pickle from an untrusted source lets the sender run code on your machine.",
    fix: "Use JSON (or another plain data format) for anything that comes from outside your app.",
  },
  "py-verify-false": {
    severity: "high",
    title: "HTTPS certificate checking is turned off (verify=False)",
    why: "Without certificate checks, anyone on the network path can read or change traffic.",
    fix: "Remove verify=False. If you hit a certificate error, fix the certificate rather than disabling the check.",
  },
  "py-debug-true": {
    severity: "medium",
    title: "Debug mode is switched on",
    why: "Debug mode can expose source code, settings and an interactive console to anyone who triggers an error.",
    fix: "Read it from an environment variable and keep it False in production.",
  },

  "public-env-secret": {
    severity: "high",
    title: "A secret is exposed to the browser through a public environment variable",
    why: "Variables starting with NEXT_PUBLIC_, VITE_, REACT_APP_ and similar are bundled into the website code that every visitor can read. A secret placed there is public.",
    fix: "Remove the public prefix and use the value only on the server. Keep only values that are meant to be public (like a publishable key) in public variables, and replace the leaked secret.",
  },
  "supabase-service-key": {
    severity: "high",
    title: "A Supabase service_role key is in the code",
    why: "The service_role key bypasses every database security rule. Anyone who finds it can read, change or delete all of your data.",
    fix: "Rotate the key in your Supabase dashboard now, then use it only on the server through an environment variable. Browser code should use the anon key together with row level security.",
  },
  "js-route-no-auth": {
    severity: "medium",
    title: "A route that changes data shows no sign of a login check",
    why: "Without a check, anyone on the internet who finds the address can create, change or delete data. AI tools often generate routes like this and forget the login check.",
    fix: "Check who the user is before doing the work, for example with auth middleware or a session check, and return 401 if they are not logged in. If the route is meant to be public, add the comment vibe-it-securely-ignore on its line.",
  },
  "sql-rls-disabled": {
    severity: "medium",
    title: "Row level security is switched off for a table",
    why: "In Supabase, tables in the public schema are reachable from the browser with the public key. Without row level security, any visitor can read or modify every row.",
    fix: "Remove the DISABLE statement, run ALTER TABLE <name> ENABLE ROW LEVEL SECURITY, and add policies that say who may read and write which rows.",
  },
  "sql-rls-missing": {
    severity: "medium",
    title: "A table is created but row level security is never enabled for it",
    why: "In Supabase, a table in the public schema without row level security can be read and changed by anyone who has your public key.",
    fix: "Add ALTER TABLE <name> ENABLE ROW LEVEL SECURITY and policies for who may read and write which rows.",
  },
  "dep-not-found": {
    severity: "high",
    title: "A dependency does not exist on the public package registry",
    why: "AI tools sometimes invent package names. If an attacker registers that name, installing your project would run their code. A misspelled name is just as dangerous.",
    fix: "Check the spelling. If the AI made the name up, remove it and find the real package that does the job.",
  },

  // ---------- Docker ----------
  "docker-root": {
    severity: "medium",
    title: "Container runs as root",
    why: "If an attacker gets into the app, they start with full control inside the container.",
    fix: "Add a USER line near the end of the Dockerfile that switches to a non-root user.",
  },
  "docker-latest": {
    severity: "medium",
    title: "Base image is not pinned to a version",
    why: "Using :latest (or no tag) means builds can silently change and pick up breaking or vulnerable versions.",
    fix: "Pin a specific version, e.g. node:22-slim, and ideally its digest.",
  },
  "docker-copy-env": {
    severity: "high",
    title: "The Dockerfile copies a .env file into the image",
    why: "Anyone who can pull the image can read the secrets inside it.",
    fix: "Remove that line and pass settings as environment variables when the container starts.",
  },
  "docker-add-url": {
    severity: "medium",
    title: "ADD downloads a file from the internet during the build",
    why: "The download is not verified, so a tampered file would end up in your image.",
    fix: "Use curl or wget in a RUN step and verify a checksum, or copy a file you already trust.",
  },
  "docker-secret-env": {
    severity: "high",
    title: "A secret is set inside the Dockerfile (ENV/ARG)",
    why: "Values set in a Dockerfile are saved in the image history where anyone with the image can read them.",
    fix: "Remove the value and supply it at runtime as an environment variable or a secret.",
  },
  "dockerignore-missing": {
    severity: "medium",
    title: "No .dockerignore file",
    why: "Without it, files like .env and .git can be copied into your image by COPY . .",
    fix: "Create a .dockerignore listing .git, .env, node_modules and similar. Running vibe-it-securely init generates one.",
  },

  // ---------- Project hygiene ----------
  "precommit-missing": {
    severity: "medium",
    title: "No pre-commit hooks set up",
    why: "Nothing stops a secret from being committed before it is too late.",
    fix: "Run vibe-it-securely init, then: pip install pre-commit && pre-commit install",
  },
  "hook-not-installed": {
    severity: "medium",
    title: "Pre-commit config exists but the hook is not installed",
    why: "The checks are configured but never run when you commit.",
    fix: "Run: pre-commit install",
  },
  "ci-missing": {
    severity: "medium",
    title: "No automated checks on your repository (CI)",
    why: "Local hooks can be skipped with --no-verify. CI is the safety net that cannot be skipped.",
    fix: "Run vibe-it-securely init to generate a GitHub Actions workflow.",
  },
  "lockfile-missing": {
    severity: "medium",
    title: "No lockfile for your JavaScript dependencies",
    why: "Without a lockfile, installs can pull different versions each time, and dependency audits are less accurate.",
    fix: "Run npm install (or pnpm/yarn install) once and commit the generated lockfile.",
  },
  "agent-rules-missing": {
    severity: "info",
    title: "No security rules for your AI coding assistant",
    why: "AI assistants follow written project rules. Without them they may write insecure code by default.",
    fix: "Run vibe-it-securely init to generate AGENTS.md (copy it to CLAUDE.md or .cursorrules if your tool needs that name).",
  },
};

const IGNORE_MARK = "vibe-it-securely-ignore";
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build",
  ".next", ".nuxt", "coverage", ".tox", ".mypy_cache", ".pytest_cache", "vendor", ".idea", ".vscode",
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|poetry\.lock|Pipfile\.lock|uv\.lock)$/;
const MAX_FILES = 5000;
const MAX_BYTES = 512 * 1024;

const SECRET_PATTERNS = [
  ["secret-private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
  ["secret-aws", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["secret-github", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["secret-slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["secret-ai-key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
];
const GENERIC_SECRET = /\b(?:api[_-]?key|secret[_-]?key|secret|password|passwd|token|auth[_-]?token)\b["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;
const PLACEHOLDER = /(your|example|change.?me|placeholder|dummy|sample|xxxx|\*\*\*\*|test|todo|<.*>)/i;

const SQL_JS = /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^`\n]*(?:\$\{|["']\s*\+)/;
const SQL_PY = /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^\n]*(?:\{[^}]+\}|["']\s*(?:\+|%))/;

const JS_PATTERNS = [
  ["js-eval", /(?<![\w.])eval\s*\(/],
  ["js-new-function", /\bnew Function\s*\(/],
  ["js-inner-html", /dangerouslySetInnerHTML|\.innerHTML\s*=(?!=)/],
  ["js-exec-template", /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{/],
  ["js-tls-off", /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/],
  ["js-cors-wildcard", /origin\s*:\s*["']\*["']/],
  ["sql-concat", SQL_JS],
];
const PY_PATTERNS = [
  ["py-eval-exec", /(?<![\w.])(?:eval|exec)\s*\(/],
  ["py-shell-true", /shell\s*=\s*True/],
  ["py-yaml-load", /\byaml\.load\s*\((?![^)]*Safe)/],
  ["py-pickle", /\bpickle\.loads?\s*\(/],
  ["py-verify-false", /verify\s*=\s*False/],
  ["py-debug-true", /^\s*DEBUG\s*=\s*True\b|\bdebug\s*=\s*True\b/],
  ["sql-concat", SQL_PY],
];
const JS_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const PY_EXT = new Set([".py"]);

function walk(dir) {
  const out = [];
  const stack = [""];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(r);
      } else if (e.isFile()) {
        out.push(r);
      }
    }
  }
  return out.sort();
}

function git(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const isEnvFile = (rel) => /(^|\/)\.env(\..+)?$/.test(rel) && !/\.(example|sample|template)$/.test(rel);
const isCommentLine = (line, ext) => {
  const t = line.trim();
  if (PY_EXT.has(ext)) return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
};

function scanFile(dir, rel, add) {
  const full = path.join(dir, rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return;
  }
  if (stat.size > MAX_BYTES || SKIP_FILES.test(rel)) return;
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    return;
  }
  if (text.includes("\u0000")) return;

  // Real .env files are meant to hold secrets: only check they do not leak to the browser
  if (isEnvFile(rel)) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (PUBLIC_ENV.test(line) && !line.includes(IGNORE_MARK)) add("public-env-secret", rel, i + 1);
    });
    return;
  }

  const ext = path.extname(rel).toLowerCase();
  const codePatterns = JS_EXT.has(ext) ? JS_PATTERNS : PY_EXT.has(ext) ? PY_PATTERNS : [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.length > 2000 || line.includes(IGNORE_MARK)) return;
    const n = i + 1;

    const vibeRule = lineSecretRule(line);
    if (vibeRule) add(vibeRule, rel, n);

    let secretHit = false;
    for (const [id, re] of SECRET_PATTERNS) {
      if (re.test(line)) {
        add(id, rel, n);
        secretHit = true;
      }
    }
    if (!secretHit) {
      const m = line.match(GENERIC_SECRET);
      if (m && !PLACEHOLDER.test(m[1]) && !/^(.)\1+$/.test(m[1])) add("secret-generic", rel, n);
    }

    if (codePatterns.length && !isCommentLine(line, ext)) {
      for (const [id, re] of codePatterns) if (re.test(line)) add(id, rel, n);
    }
  });

  if (JS_EXT.has(ext)) checkRoutes(rel, lines, add);
}

function checkDockerfile(rel, text, add) {
  const lines = text.split(/\r?\n/);
  const aliases = new Set();
  let lastFrom = -1;

  lines.forEach((l, i) => {
    const m = l.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (!m || l.includes(IGNORE_MARK)) return;
    lastFrom = i;
    const img = m[1];
    const pinned = img.includes("@sha256:");
    const hasTag = /:[^/]+$/.test(img) && !img.endsWith(":latest");
    const isAlias = aliases.has(img);
    if (m[2]) aliases.add(m[2]);
    if (img.toLowerCase() !== "scratch" && !isAlias && !/\$\{?\w+/.test(img) && !pinned && !hasTag) {
      add("docker-latest", rel, i + 1);
    }
  });

  if (lastFrom >= 0) {
    let user = null;
    for (let i = lastFrom; i < lines.length; i++) {
      const m = lines[i].match(/^\s*USER\s+(\S+)/i);
      if (m) user = m[1];
    }
    if (user === null || /^(root|0)(:|$)/.test(user)) add("docker-root", rel, lastFrom + 1);
  }

  lines.forEach((l, i) => {
    if (l.includes(IGNORE_MARK)) return;
    const n = i + 1;
    if (/^\s*(?:COPY|ADD)\s+.*\.env(?!\.example|\.sample|\.template)(?=\s|$)/i.test(l)) add("docker-copy-env", rel, n);
    if (/^\s*ADD\s+https?:\/\//i.test(l)) add("docker-add-url", rel, n);
    if (/^\s*(?:ENV|ARG)\s+[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*(?:\s*=\s*|\s+)(?!\$)\S+/i.test(l)) {
      add("docker-secret-env", rel, n);
    }
  });
}

/** Reads .vibe-it-securely-ignore: one path or folder prefix per line, # for comments. */
function loadIgnore(dir) {
  try {
    return fs
      .readFileSync(path.join(dir, ".vibe-it-securely-ignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^\.?\//, ""))
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}
const isIgnored = (rel, patterns) =>
  patterns.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p || rel.startsWith(p + "/")));

export function check(dir) {
  const stack = detectStack(dir);
  const findings = [];
  const add = (ruleId, file, line, detail) => findings.push({ ruleId, severity: RULES[ruleId].severity, file, line, detail });

  const ignored = loadIgnore(dir);
  const files = walk(dir).filter((f) => !isIgnored(f, ignored));
  const has = (f) => fs.existsSync(path.join(dir, f));

  for (const rel of files) scanFile(dir, rel, add);
  analyzeSql(dir, files.filter((f) => f.endsWith(".sql")), detectSupabase(dir, files), add);

  const dockerfiles = files.filter((f) => /^(Dockerfile(\.[\w.-]+)?|[\w.-]+\.dockerfile)$/i.test(path.basename(f)) && !f.endsWith(".suggested"));
  for (const rel of dockerfiles) {
    try {
      checkDockerfile(rel, fs.readFileSync(path.join(dir, rel), "utf8"), add);
    } catch {
      /* unreadable file: skip */
    }
  }
  if (dockerfiles.length && !has(".dockerignore")) add("dockerignore-missing");

  // .env handling
  const tracked = git(dir, ["ls-files"]);
  if (tracked !== null) {
    for (const f of tracked.split("\n").filter(Boolean)) if (isEnvFile(f)) add("env-committed", f);
  }
  const hasEnv = files.some((f) => isEnvFile(f)) || has(".env.example");
  if (hasEnv) {
    let ignored = false;
    try {
      ignored = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split(/\r?\n/).some((l) => /^\/?\*?\.env(\*|\.\*)?$/.test(l.trim()) || l.trim() === "*.env");
    } catch {
      /* no .gitignore */
    }
    if (!ignored) add("env-not-ignored");
  }

  // hooks, CI, lockfile, agent rules
  const hookTool = has(".pre-commit-config.yaml") || has(".husky") || has("lefthook.yml");
  if (!hookTool) add("precommit-missing");
  else if (has(".pre-commit-config.yaml") && fs.existsSync(path.join(dir, ".git")) && fs.statSync(path.join(dir, ".git")).isDirectory() && !has(".git/hooks/pre-commit")) {
    add("hook-not-installed");
  }

  let hasCI = has(".gitlab-ci.yml");
  try {
    hasCI = hasCI || fs.readdirSync(path.join(dir, ".github/workflows")).some((f) => /\.ya?ml$/.test(f));
  } catch {
    /* no workflows dir */
  }
  if (!hasCI) add("ci-missing");

  if (stack.node && !["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].some(has)) add("lockfile-missing");
  if (!["AGENTS.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md", ".cursor/rules"].some(has)) add("agent-rules-missing");

  return { stack, findings, filesScanned: files.length };
}
