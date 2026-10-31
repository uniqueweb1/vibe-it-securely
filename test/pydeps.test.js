import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requirementsNames, pyprojectNames, pipfileNames } from "../src/pydeps.js";
import { checkDependencies } from "../src/deps.js";
import { init } from "../src/init.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sby-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const sorted = (r) => [...r.names].sort();

test("pyproject.toml (standard): single and multi-line arrays, extras, markers, comments, URLs", () => {
  const r = pyprojectNames(`
[project]
name = "demo"
description = """A long
description with "quotes" and dependencies = ["not-a-package"]
"""
dependencies = [
  "fastapi[all]>=0.100",   # web framework
  "Flask_Login==0.6 ; python_version < '3.12'",
  # "commented-out-package",
  "internal-tool @ git+https://github.com/acme/internal-tool.git",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[dependency-groups]
lint = ["mypy", {include-group = "dev"}]
`);
  assert.deepEqual(sorted(r), ["fastapi", "flask-login", "mypy", "pytest", "ruff"]);
  assert.equal(r.privateIndex, false);
});

test("pyproject.toml (uv): dev-dependencies, and packages from tool.uv.sources are skipped", () => {
  const r = pyprojectNames(`
[project]
dependencies = ["requests", "mylib"]

[tool.uv]
dev-dependencies = ["pytest"]

[tool.uv.sources]
mylib = { git = "https://github.com/acme/mylib" }
`);
  assert.deepEqual(sorted(r), ["pytest", "requests"]);
});

test("pyproject.toml (Poetry): groups and dev-dependencies; python, git, path and custom-source packages skipped", () => {
  const r = pyprojectNames(`
[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = { version = "^0.100", extras = ["all"] }
Requests = "^2.31"
localpkg = { path = "../localpkg" }
gitpkg = { git = "https://github.com/acme/gitpkg.git" }
private-thing = { version = "^1", source = "acme" }

[tool.poetry.group.dev.dependencies]
pytest = "^8"

[tool.poetry.dev-dependencies]
black = "*"
`);
  assert.deepEqual(sorted(r), ["black", "fastapi", "pytest", "requests"]);
});

test("a private package index makes the names unverifiable", () => {
  assert.equal(pyprojectNames('[project]\ndependencies = ["x"]\n[[tool.poetry.source]]\nname = "acme"\nurl = "https://pypi.acme.example"\n').privateIndex, true);
  assert.equal(pyprojectNames('[project]\ndependencies = ["x"]\n[[tool.uv.index]]\nurl = "https://pypi.acme.example"\n').privateIndex, true);
  assert.equal(requirementsNames("--extra-index-url https://pypi.acme.example/simple\nx\n").privateIndex, true);
  assert.equal(requirementsNames("-i https://pypi.org/simple\nx\n").privateIndex, false);
  assert.equal(pipfileNames('[[source]]\nurl = "https://pypi.acme.example/simple"\nname = "acme"\n[packages]\nx = "*"\n').privateIndex, true);
  assert.equal(pipfileNames('[[source]]\nurl = "https://pypi.org/simple"\nname = "pypi"\n[packages]\nx = "*"\n').privateIndex, false);
});

test("Pipfile: packages and dev-packages; git, path and editable entries skipped", () => {
  const r = pipfileNames(`
[[source]]
url = "https://pypi.org/simple"
verify_ssl = true
name = "pypi"

[packages]
fastapi = "*"
Django = {version = ">=4", extras = ["argon2"]}
mylocal = {path = ".", editable = true}
fromgit = {git = "https://github.com/acme/x.git", ref = "main"}

[dev-packages]
pytest = "*"

[requires]
python_version = "3.12"
`);
  assert.deepEqual(sorted(r), ["django", "fastapi", "pytest"]);
});

test("requirements.txt: comments, options, URLs and extras", () => {
  const r = requirementsNames("# comment\nflask_zzz==1.0  # pinned\nuvicorn[standard]>=0.2\n-r other.txt\ngit+https://x/y.git\nlocal @ file:///tmp/x\n");
  assert.deepEqual(sorted(r), ["flask-zzz", "uvicorn"]);
});

test("--online checks pyproject.toml and Pipfile projects and names the right file", async () => {
  const d = tmp();
  write(d, "svc-a/pyproject.toml", '[project]\ndependencies = ["fastapi", "made_up_pkg_a>=1"]\n');
  write(d, "svc-b/Pipfile", '[packages]\nrequests = "*"\nmade-up-pkg-b = "*"\n');
  write(d, "svc-c/pyproject.toml", '[tool.poetry.dependencies]\npython = "^3.11"\nmade-up-pkg-c = "^1"\n');
  const fetchImpl = async (url) => ({ status: /made-up/.test(url) ? 404 : 200, ok: !/made-up/.test(url) });
  const r = await checkDependencies(d, { fetchImpl });
  assert.deepEqual(r.findings.map((f) => `${f.file}: ${f.detail}`).sort(), [
    "svc-a/pyproject.toml: made-up-pkg-a on PyPI",
    "svc-b/Pipfile: made-up-pkg-b on PyPI",
    "svc-c/pyproject.toml: made-up-pkg-c on PyPI",
  ]);
  assert.equal(r.checked, 5);
});

test("--online does not flag packages from a private index", async () => {
  const d = tmp();
  write(d, "pyproject.toml", '[project]\ndependencies = ["acme-internal"]\n[[tool.uv.index]]\nurl = "https://pypi.acme.example"\n');
  const r = await checkDependencies(d, { fetchImpl: async () => ({ status: 404, ok: false }) });
  assert.equal(r.findings.length, 0);
  assert.equal(r.unverified, 1);
});

test("the same package listed in two Python files is looked up once", async () => {
  const d = tmp();
  write(d, "requirements.txt", "fastapi\n");
  write(d, "pyproject.toml", '[project]\ndependencies = ["fastapi"]\n');
  const seen = [];
  await checkDependencies(d, { fetchImpl: async (u) => (seen.push(u), { status: 200, ok: true }) });
  assert.equal(seen.length, 1);
});

test("Pipenv projects get a real audit step in CI and a note about the lock file", () => {
  const d = tmp();
  write(d, "Pipfile", '[packages]\nfastapi = "*"\n');
  const r = init({ dir: d });
  const ci = fs.readFileSync(path.join(d, ".github/workflows/security.yml"), "utf8");
  assert.ok(ci.includes("pipenv requirements > audit-requirements.txt") && ci.includes("pip-audit -r audit-requirements.txt"));
  assert.ok(!ci.includes("TODO: Pipfile"));
  assert.ok(r.notes.some((n) => n.includes("Pipfile.lock")));

  write(d, "Pipfile.lock", "{}");
  assert.ok(!init({ dir: d }).notes.some((n) => n.includes("Pipfile.lock")));
});

test("Pipenv Dockerfile installs from the lock file (only with --docker)", () => {
  const d = tmp();
  write(d, "Pipfile", '[packages]\nfastapi = "*"\n');
  init({ dir: d, docker: true });
  const df = fs.readFileSync(path.join(d, "Dockerfile"), "utf8");
  assert.ok(df.includes("COPY Pipfile Pipfile.lock ./") && df.includes("pipenv requirements"));
});

test("pyproject projects keep the pip-audit . step", () => {
  const d = tmp();
  write(d, "pyproject.toml", '[project]\ndependencies = ["fastapi"]\n');
  init({ dir: d });
  assert.ok(fs.readFileSync(path.join(d, ".github/workflows/security.yml"), "utf8").includes("pip-audit ."));
});
