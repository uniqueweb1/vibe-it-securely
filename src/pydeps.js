// Minimal readers for Python dependency files. There is no TOML library: these only
// extract dependency NAMES, and they are deliberately conservative. Anything that looks
// like a git/path/URL dependency or a private package index is skipped, never reported.

const normalize = (name) => name.toLowerCase().replace(/[_.]+/g, "-");

/** Removes a trailing # comment, ignoring # characters inside quotes. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/** How many more [ or { than ] or } a line opens, ignoring brackets inside quotes. */
function bracketDelta(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth;
}

/** Flattens a TOML-ish file into { table, key, value } entries. Multi-line arrays are joined. */
function tomlEntries(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let table = "";
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    const header = line.match(/^\[{1,2}\s*([^\]]+?)\s*\]{1,2}$/);
    if (header) {
      table = header[1].replace(/\s*\.\s*/g, ".");
      continue;
    }

    const kv = line.match(/^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].replace(/^["']|["']$/g, "");
    let value = kv[2];

    const triple = value.match(/^("""|''')/);
    if (triple) {
      // multi-line string (usually a description): skip to its closing quotes
      let rest = value.slice(3);
      while (!rest.includes(triple[1]) && i + 1 < lines.length) {
        i++;
        rest = lines[i];
      }
      continue;
    }

    let depth = bracketDelta(value);
    while (depth > 0 && i + 1 < lines.length) {
      i++;
      const next = stripComment(lines[i]);
      value += "\n" + next;
      depth += bracketDelta(next);
    }
    entries.push({ table, key, value });
  }
  return entries;
}

/** Quoted strings in an array value, except values of inline tables like { include-group = "dev" }. */
function arrayStrings(value) {
  const out = [];
  const re = /(["'])((?:(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(value))) {
    if (value.slice(0, m.index).trimEnd().endsWith("=")) continue;
    out.push(m[2]);
  }
  return out;
}

/** "fastapi[all]>=0.1; python_version<'3.12'" -> "fastapi". Null for URL, git and path requirements. */
function requirementName(spec) {
  const s = spec.trim();
  if (!s || s.startsWith("-")) return null;
  if (/^(?:git\+|https?:|file:|\.|\/)/i.test(s) || /@\s*(?:git\+|https?:|file:)/i.test(s)) return null;
  const m = s.match(/^([A-Za-z][A-Za-z0-9._-]*)/); // must start with a letter: avoids garbage from odd quoting
  return m ? normalize(m[1]) : null;
}

const LOCAL_OR_URL = /\b(?:git|path|file|url|editable)\s*=/;
const unique = (list) => [...new Set(list)];

/** requirements.txt. A private index makes the names unverifiable against the public registry. */
export function requirementsNames(text) {
  const names = [];
  let privateIndex = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(/\s#/)[0].replace(/^#.*$/, "").trim();
    if (!line) continue;
    const idx = line.match(/^(?:-i|--index-url|--extra-index-url)(?:\s+|=)(\S+)/);
    if (idx) {
      if (!/pypi\.org/.test(idx[1])) privateIndex = true;
      continue;
    }
    if (line.startsWith("-") || /^(?:git\+|https?:|file:|\.|\/)/i.test(line) || line.includes("@")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
    if (m) names.push(normalize(m[1]));
  }
  return { names: unique(names), privateIndex };
}

/** pyproject.toml: standard (PEP 621) dependencies, optional groups, dependency-groups, uv and Poetry. */
export function pyprojectNames(text) {
  const names = [];
  const excluded = new Set(); // packages that come from git, a path or a custom source
  let privateIndex = false;

  for (const { table, key, value } of tomlEntries(text)) {
    if (table === "project" && key === "dependencies") names.push(...arrayStrings(value).map(requirementName));
    else if (table === "project.optional-dependencies" || table === "dependency-groups") names.push(...arrayStrings(value).map(requirementName));
    else if (table === "tool.uv" && key === "dev-dependencies") names.push(...arrayStrings(value).map(requirementName));
    else if (table === "tool.uv.sources") excluded.add(normalize(key));
    else if (/^tool\.poetry\.(?:group\.[^.]+\.)?(?:dev-)?dependencies$/.test(table)) {
      if (key.toLowerCase() === "python") continue;
      if (LOCAL_OR_URL.test(value) || /\bsource\s*=/.test(value)) continue;
      names.push(requirementName(key));
    }
    if (table === "tool.poetry.source" || table === "tool.uv.index" || (table === "tool.uv" && /index/.test(key))) privateIndex = true;
  }
  return { names: unique(names.filter((n) => n && !excluded.has(n))), privateIndex };
}

/** Pipfile: [packages] and [dev-packages]. */
export function pipfileNames(text) {
  const names = [];
  let privateIndex = false;
  for (const { table, key, value } of tomlEntries(text)) {
    if ((table === "packages" || table === "dev-packages") && !LOCAL_OR_URL.test(value)) names.push(requirementName(key));
    if (table === "source" && key === "url" && !/pypi\.org/.test(value)) privateIndex = true;
  }
  return { names: unique(names.filter(Boolean)), privateIndex };
}
