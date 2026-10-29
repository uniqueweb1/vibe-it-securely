import { RULES } from "./check.js";

const ORDER = ["high", "medium", "info"];
const LABEL = { high: "HIGH  ", medium: "MEDIUM", info: "INFO  " };
const HEADING = {
  high: "Fix these first",
  medium: "Should fix",
  info: "Suggestions",
};

/** Plain-text report. Never prints matched secret values, only locations. */
export function formatReport(result, { maxLocations = 5 } = {}) {
  const { findings, filesScanned } = result;
  const out = [];

  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.ruleId)) groups.set(f.ruleId, []);
    groups.get(f.ruleId).push(f);
  }

  const counts = { high: 0, medium: 0, info: 0 };
  for (const [ruleId, list] of groups) counts[RULES[ruleId].severity] += list.length;

  for (const sev of ORDER) {
    const ruleIds = [...groups.keys()].filter((id) => RULES[id].severity === sev);
    if (!ruleIds.length) continue;
    out.push(`== ${HEADING[sev]} ==`, "");
    for (const id of ruleIds) {
      const rule = RULES[id];
      const list = groups.get(id);
      out.push(`[${LABEL[sev]}] ${rule.title}`);
      const located = list.filter((f) => f.file);
      if (located.length) {
        const shown = located.slice(0, maxLocations).map((f) => (f.line ? `${f.file}:${f.line}` : f.file));
        const more = located.length - shown.length;
          out.push(`  Where: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`);
      }
      out.push(`  Why:   ${rule.why}`, `  Fix:   ${rule.fix}`, "");
    }
  }

  const total = counts.high + counts.medium + counts.info;
  out.push(`Scanned ${filesScanned} files. Found ${counts.high} high, ${counts.medium} medium, ${counts.info} info.`);
  if (total === 0) out.push("Nothing found by these checks.");
  out.push(
    "This is a baseline check, not a security audit. A clean result does not mean your project is secure.",
    "False alarm? Add the comment secure-baseline-ignore to that line.",
  );
  return out.join("\n");
}

export function countBySeverity(findings) {
  const c = { high: 0, medium: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}
