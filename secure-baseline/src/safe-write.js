import fs from "node:fs";
import path from "node:path";

/**
 * Write a file without ever overwriting an existing one.
 * If the target exists, write "<name>.suggested" next to it
 * (or skip entirely when onExists === "skip").
 */
export function safeWrite(dir, relPath, content, { dryRun = false, onExists = "suggest" } = {}) {
  const exists = fs.existsSync(path.join(dir, relPath));
  let outRel = relPath;
  let status = "created";

  if (exists) {
    if (onExists === "skip") return { path: relPath, status: "skipped-exists" };
    outRel = relPath + ".suggested";
    if (fs.existsSync(path.join(dir, outRel))) return { path: outRel, status: "skipped-exists" };
    status = "suggested";
  }

  if (!dryRun) {
    const out = path.join(dir, outRel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content, { flag: "wx" }); // wx = fail rather than overwrite
  }
  return { path: outRel, status: dryRun ? "would-be-" + status : status };
}
