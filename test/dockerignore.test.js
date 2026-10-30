import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../src/check.js";
import { init } from "../src/init.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbd-"));
const write = (d, f, c = "") => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const missing = (d) => check(d).findings.filter((f) => f.ruleId === "dockerignore-missing").map((f) => f.file);
const DOCKERFILE = "FROM node:22-slim\nUSER node\n";

test("files that init generates in project folders are not flagged afterwards", () => {
  const d = tmp();
  write(d, "frontend/package.json", "{}");
  write(d, "backend/requirements.txt", "fastapi\n");
  init({ dir: d, docker: true });
  assert.deepEqual(missing(d), []);
});

test("a Dockerfile in a subfolder without any .dockerignore is flagged, with its path", () => {
  const d = tmp();
  write(d, "backend/Dockerfile", DOCKERFILE);
  assert.deepEqual(missing(d), ["backend/Dockerfile"]);
});

test("each Dockerfile is judged on its own", () => {
  const d = tmp();
  write(d, "a/Dockerfile", DOCKERFILE);
  write(d, "a/.dockerignore", ".env\n");
  write(d, "b/Dockerfile", DOCKERFILE);
  assert.deepEqual(missing(d), ["b/Dockerfile"]);
});

test("a .dockerignore in the repository root covers subfolder Dockerfiles", () => {
  const d = tmp();
  write(d, "backend/Dockerfile", DOCKERFILE);
  write(d, ".dockerignore", ".env\n");
  assert.deepEqual(missing(d), []);
});

test("<Dockerfile name>.dockerignore beside the Dockerfile counts", () => {
  const d = tmp();
  write(d, "Dockerfile.node", DOCKERFILE);
  write(d, "Dockerfile.node.dockerignore", ".env\n");
  assert.deepEqual(missing(d), []);
});

test("a root Dockerfile with no .dockerignore is still flagged", () => {
  const d = tmp();
  write(d, "Dockerfile", DOCKERFILE);
  assert.deepEqual(missing(d), ["Dockerfile"]);
});
