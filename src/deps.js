import fs from "node:fs";
import path from "node:path";
import { RULES } from "./check.js";
import { detectWorkspace } from "./detect.js";

const NON_REGISTRY_SPEC = /^(?:file:|link:|git\+|git:|github:|gitlab:|bitbucket:|https?:|workspace:|npm:|portal:|patch:)/i;

function npmNames(dir) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const all = { ...pkg.optionalDependencies, ...pkg.devDependencies, ...pkg.dependencies };
  return Object.entries(all)
    .filter(([, spec]) => typeof spec === "string" && !NON_REGISTRY_SPEC.test(spec.trim()) && !/^[./~]/.test(spec.trim()))
    .map(([name]) => name);
}

function pythonNames(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "requirements.txt"), "utf8");
  } catch {
    return [];
  }
  const names = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line || line.startsWith("-") || /^(?:git\+|https?:|file:|\.|\/)/i.test(line) || line.includes("@")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
    if (m) names.push(m[1].toLowerCase().replace(/[_.]+/g, "-"));
  }
  return names;
}

/** Scopes (or everything) that a folder resolves from a private registry: these cannot be checked publicly. */
function privateRegistry(...dirs) {
  const scopes = new Set();
  let all = false;
  for (const dir of dirs) {
    try {
      for (const l of fs.readFileSync(path.join(dir, ".npmrc"), "utf8").split(/\r?\n/)) {
        const scoped = l.match(/^\s*(@[\w.-]+):registry\s*=/);
        if (scoped) scopes.add(scoped[1]);
        const global = l.match(/^\s*registry\s*=\s*(\S+)/);
        if (global && !/registry\.npmjs\.org/.test(global[1])) all = true;
      }
    } catch {
      /* no .npmrc here */
    }
  }
  return { scopes, all };
}

async function exists(url, fetchImpl, timeoutMs, headers) {
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) return false;
    if (res.ok) return true;
    return null; // rate limit, server error, etc.: cannot tell
  } catch {
    return null;
  }
}

/**
 * Checks that every dependency name, in every project folder, actually exists on npm / PyPI.
 * AI tools sometimes invent package names; an attacker can register such a name.
 * Network failures never produce findings, they are counted as "unverified".
 */
export async function checkDependencies(dir, { fetchImpl = globalThis.fetch, concurrency = 8, timeoutMs = 8000 } = {}) {
  const { projects } = detectWorkspace(dir);
  const jobs = [];
  let unverified = 0;

  for (const p of projects) {
    const abs = path.join(dir, p.path);
    const prefix = p.path ? p.path + "/" : "";
    const priv = privateRegistry(dir, abs);

    for (const name of npmNames(abs)) {
      const scope = name.startsWith("@") ? name.split("/")[0] : null;
      if (priv.all || (scope && priv.scopes.has(scope))) {
        unverified++;
        continue;
      }
      jobs.push({ eco: "npm", name, file: prefix + "package.json", url: "https://registry.npmjs.org/" + encodeURIComponent(name), headers: { Accept: "application/vnd.npm.install-v1+json" } });
    }
    for (const name of pythonNames(abs)) {
      jobs.push({ eco: "PyPI", name, file: prefix + "requirements.txt", url: "https://pypi.org/pypi/" + encodeURIComponent(name) + "/json", headers: {} });
    }
  }

  const cache = new Map(); // the same package used in several folders is only looked up once
  const findings = [];
  let checked = 0;
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const key = job.eco + ":" + job.name;
      if (!cache.has(key)) cache.set(key, exists(job.url, fetchImpl, timeoutMs, job.headers));
      const result = await cache.get(key);
      if (result === null) unverified++;
      else {
        checked++;
        if (result === false) {
          findings.push({ ruleId: "dep-not-found", severity: RULES["dep-not-found"].severity, file: job.file, line: undefined, detail: `${job.name} on ${job.eco}` });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { findings, checked, unverified };
}
