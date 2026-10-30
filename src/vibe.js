import fs from "node:fs";
import path from "node:path";

const IGNORE = "vibe-it-securely-ignore";

// ---------------------------------------------------------------------------
// Secrets that leak through naming mistakes
// ---------------------------------------------------------------------------

/** Env variables that are exposed to the browser but are named like secrets. */
export const PUBLIC_ENV = /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*/;

export const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

/** Reads the "role" claim of a JWT without verifying it. Returns null if unreadable. */
export function jwtRole(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

export const SERVICE_LITERAL = /service_?role\w*["']?\s*[:=]\s*["'`]([A-Za-z0-9._-]{20,})["'`]/i;
const PLACEHOLDER = /(your|example|change.?me|placeholder|dummy|sample|xxxx|\*\*\*\*|todo|<.*>)/i;

/** Per-line Supabase / public-env checks. Returns a rule id or null. */
export function lineSecretRule(line) {
  const jwt = line.match(JWT_RE);
  if (jwt && jwtRole(jwt[0]) === "service_role") return "supabase-service-key";
  const lit = line.match(SERVICE_LITERAL);
  if (lit && !PLACEHOLDER.test(lit[1])) return "supabase-service-key";
  if (PUBLIC_ENV.test(line)) return "public-env-secret";
  return null;
}

// ---------------------------------------------------------------------------
// Routes that change data without any sign of authentication
// ---------------------------------------------------------------------------

const ROUTE_RE = /\b(?:app|router|server|fastify|\w*Router|\w*router)\.(post|put|patch|delete)\s*\(\s*(["'`])([^"'`]+)\2/;
const ANY_ROUTE = /\b(?:app|router|server|fastify|\w*Router|\w*router)\.(?:get|post|put|patch|delete)\s*\(/;
const PUBLIC_PATH = /(login|log-in|signin|sign-in|signup|sign-up|register|webhook|callback|health|ping|auth|csrf|logout|forgot|reset-password|contact|subscribe|newsletter|public)/i;
const AUTH_ARGS = /(auth|jwt|verify|protect|passport|session|token|guard|login|requireUser|isLoggedIn|ensure|permission|role|clerk|middleware)/i;
const AUTH_USE = /(auth|jwt|verify|passport|session|protect|guard|token|clerk)/i;
const AUTH_BODY = /(req\.user|req\.session|req\.auth|getUser|getSession|getServerSession|currentUser|verifyToken|jwt\.verify|authorization|\b401\b|\b403\b|unauthori[sz]ed|forbidden|isAuthenticated)/i;
const NEXT_AUTH = /(getServerSession|getSession|\bauth\(\)|currentUser|getToken|getUser|verifyToken|jwt|withAuth|requireAuth|clerk|supabase\.auth|authorization|req\.user|session)/i;
const NEXT_APP_ROUTE = /(^|\/)app\/(?:.*\/)?route\.(?:[jt]sx?|mjs)$/;
const NEXT_PAGES_API = /(^|\/)pages\/api\//;
const NEXT_APP_EXPORT = /export\s+(?:async\s+function|function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/;
const NEXT_PAGES_MUTATION = /req\.method\s*===?\s*["'](?:POST|PUT|PATCH|DELETE)["']|\.(?:insert|update|delete|create|upsert|destroy)\w*\s*\(/;

/** Heuristic: flags routes that change data and show no sign of an auth check. */
export function checkRoutes(rel, lines, add) {
  if (/\.(test|spec)\.[jt]sx?$/.test(rel) || /(^|\/)(tests?|__tests__)\//.test(rel)) return;
  const text = lines.join("\n");

  if (NEXT_APP_ROUTE.test(rel) || NEXT_PAGES_API.test(rel)) {
    if (PUBLIC_PATH.test(rel) || NEXT_AUTH.test(text)) return;
    const pattern = NEXT_APP_ROUTE.test(rel) ? NEXT_APP_EXPORT : NEXT_PAGES_MUTATION;
    const idx = lines.findIndex((l) => pattern.test(l) && !l.includes(IGNORE));
    if (idx >= 0) add("js-route-no-auth", rel, idx + 1);
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(ROUTE_RE);
    if (!m || line.includes(IGNORE) || PUBLIC_PATH.test(m[3])) continue;

    // 1. middleware listed in the route arguments, before the handler starts
    const win = lines.slice(i, i + 4).join("\n");
    const after = win.slice(win.indexOf(m[0]) + m[0].length);
    const cut = after.search(/=>|function|;|\.(?:get|post|put|patch|delete|use)\s*\(/);
    if (AUTH_ARGS.test(cut >= 0 ? after.slice(0, cut) : after)) continue;

    // 2. an auth middleware registered earlier for the whole app/router
    if (lines.slice(0, i).some((l) => /\.use\s*\(/.test(l) && AUTH_USE.test(l))) continue;

    // 3. an auth check inside the handler
    let body = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 26) && !ANY_ROUTE.test(lines[j]); j++) body.push(lines[j]);
    if (AUTH_BODY.test(body.join("\n"))) continue;

    add("js-route-no-auth", rel, i + 1);
  }
}

// ---------------------------------------------------------------------------
// Supabase row level security (SQL migrations)
// ---------------------------------------------------------------------------

const stripSqlComments = (s) => s.replace(/--.*$/gm, (c) => " ".repeat(c.length));

export function analyzeSql(dir, sqlFiles, usesSupabase, add) {
  if (!usesSupabase) return;
  const created = new Map(); // table -> {file, line}
  const enabled = new Set();

  for (const rel of sqlFiles) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const text = stripSqlComments(raw);
    const lineOf = (index) => text.slice(0, index).split("\n").length;

    for (const m of text.matchAll(/disable\s+row\s+level\s+security/gi)) {
      if (!raw.split("\n")[lineOf(m.index) - 1]?.includes(IGNORE)) add("sql-rls-disabled", rel, lineOf(m.index));
    }
    for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
      const schema = (m[1] || "public").toLowerCase();
      if (schema !== "public") continue;
      created.set(m[2].toLowerCase(), { file: rel, line: lineOf(m.index) });
    }
    for (const m of text.matchAll(/alter\s+table\s+(?:only\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi)) {
      enabled.add(m[2].toLowerCase());
    }
  }
  for (const [table, where] of created) {
    if (!enabled.has(table)) add("sql-rls-missing", where.file, where.line, table);
  }
}

export function detectSupabase(dir, files) {
  if (files.some((f) => f.startsWith("supabase/"))) return true;
  for (const f of files) {
    const base = path.basename(f);
    if (base !== "package.json" && base !== "requirements.txt") continue;
    try {
      if (/supabase/i.test(fs.readFileSync(path.join(dir, f), "utf8"))) return true;
    } catch {
      /* unreadable manifest: skip */
    }
  }
  return false;
}
