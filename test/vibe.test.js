import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../src/check.js";
import { checkDependencies } from "../src/deps.js";
import { jwtRole } from "../src/vibe.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbv-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const ids = (r) => r.findings.map((f) => f.ruleId);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// Fake tokens are assembled at runtime so this file never holds a real-looking secret
const fakeJwt = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role })}.${"s".repeat(24)}`;

test("jwtRole reads the role claim", () => {
  assert.equal(jwtRole(fakeJwt("service_role")), "service_role");
  assert.equal(jwtRole("not-a-jwt"), null);
});

test("Supabase service_role JWT is high; anon JWT is fine", () => {
  const d = tmp();
  write(d, "a.js", `const k = "${fakeJwt("service_role")}";\n`);
  write(d, "b.js", `const k = "${fakeJwt("anon")}";\n`);
  const hits = check(d).findings.filter((f) => f.ruleId === "supabase-service-key");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "a.js");
  assert.equal(hits[0].severity, "high");
});

test("service role literal flagged, placeholder is not", () => {
  const d = tmp();
  const fakeKey = ["abcdefghij", "klmnopqrst", "uvwxyz1234"].join(""); // assembled at runtime so secret scanners see no literal
  write(d, "a.js", `const SUPABASE_SERVICE_ROLE_KEY = "${fakeKey}";\n`);
  write(d, "b.js", 'const SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key-here";\n');
  const hits = check(d).findings.filter((f) => f.ruleId === "supabase-service-key");
  assert.deepEqual(hits.map((h) => h.file), ["a.js"]);
});

test("secret in a public env variable is flagged, even inside .env", () => {
  const d = tmp();
  write(d, ".env", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=abc\nNEXT_PUBLIC_SUPABASE_ANON_KEY=abc\nDATABASE_PASSWORD=hunter2\n");
  const hits = check(d).findings.filter((f) => f.ruleId === "public-env-secret");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test("Express routes: unprotected mutation flagged", () => {
  const d = tmp();
  write(d, "server.js", "app.post('/api/items', (req, res) => {\n  db.insert(req.body);\n  res.send('ok');\n});\n");
  assert.ok(ids(check(d)).includes("js-route-no-auth"));
});

test("Express routes: middleware, app-level auth, in-handler check and public paths are accepted", () => {
  const d = tmp();
  write(d, "a.js", "app.post('/api/items', requireAuth, (req, res) => { res.send(1); });\n");
  write(d, "b.js", "app.use(authMiddleware);\napp.delete('/api/items/:id', (req, res) => { res.send(1); });\n");
  write(d, "c.js", "app.put('/api/items/:id', (req, res) => {\n  if (!req.user) return res.status(401).end();\n  res.send(1);\n});\n");
  write(d, "d.js", "app.post('/login', (req, res) => { res.send(1); });\napp.post('/webhook/stripe', (req, res) => { res.send(1); });\n");
  write(d, "e.js", "api.post('/items', body);\naxios.post('/items', body);\n");
  write(d, "f.test.js", "app.post('/api/items', (req, res) => { res.send(1); });\n");
  assert.ok(!ids(check(d)).includes("js-route-no-auth"));
});

test("Express routes: ignore marker works", () => {
  const d = tmp();
  write(d, "a.js", "app.post('/api/feedback', (req, res) => { res.send(1); }); // secure-baseline-ignore\n");
  assert.ok(!ids(check(d)).includes("js-route-no-auth"));
});

test("Next.js app router and pages/api", () => {
  const d = tmp();
  write(d, "app/api/items/route.ts", "export async function POST(req) {\n  return Response.json({});\n}\n");
  write(d, "app/api/safe/route.ts", "export async function POST(req) {\n  const session = await getServerSession();\n  return Response.json({});\n}\n");
  write(d, "pages/api/things.js", "export default function handler(req, res) {\n  if (req.method === 'POST') { db.insert(1); }\n}\n");
  const files = check(d).findings.filter((f) => f.ruleId === "js-route-no-auth").map((f) => f.file).sort();
  assert.deepEqual(files, ["app/api/items/route.ts", "pages/api/things.js"]);
});

test("RLS: missing and disabled are reported in Supabase projects", () => {
  const d = tmp();
  write(d, "supabase/migrations/001.sql", [
    "create table public.todos (id int);",
    "create table notes (id int);",
    "alter table notes enable row level security;",
    "create table private.internal (id int);",
    "alter table accounts disable row level security;",
  ].join("\n"));
  const r = check(d);
  const missing = r.findings.filter((f) => f.ruleId === "sql-rls-missing");
  assert.deepEqual(missing.map((f) => f.detail), ["todos"]);
  assert.ok(ids(r).includes("sql-rls-disabled"));
});

test("RLS rules stay quiet outside Supabase projects", () => {
  const d = tmp();
  write(d, "db/schema.sql", "create table todos (id int);\n");
  const got = ids(check(d));
  assert.ok(!got.includes("sql-rls-missing") && !got.includes("sql-rls-disabled"));
});

// ---- dependency existence ----
const resp = (status) => ({ status, ok: status >= 200 && status < 300 });

test("dependency check: missing packages are high, real ones are not", async () => {
  const d = tmp();
  write(d, "package.json", JSON.stringify({ dependencies: { express: "4", "totally-made-up-pkg": "1", local: "file:../local", "@acme/x": "1" } }));
  write(d, "requirements.txt", "flask==3.0\nnot_a_real_py_pkg>=1\n-r other.txt\n# comment\n");
  write(d, ".npmrc", "@acme:registry=https://npm.internal.example\n");
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return resp(/made-up|not-a-real/.test(url) ? 404 : 200);
  };
  const r = await checkDependencies(d, { fetchImpl });
  assert.deepEqual(r.findings.map((f) => f.detail).sort(), ["not-a-real-py-pkg on PyPI", "totally-made-up-pkg on npm"]);
  assert.ok(r.findings.every((f) => f.severity === "high"));
  assert.equal(r.unverified, 1); // the private @acme scope
  assert.ok(!seen.some((u) => u.includes("local")), "file: specs must not be queried");
});

test("dependency check: network failures produce no findings", async () => {
  const d = tmp();
  write(d, "package.json", JSON.stringify({ dependencies: { express: "4" } }));
  const r = await checkDependencies(d, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(r.findings.length, 0);
  assert.equal(r.unverified, 1);
});
