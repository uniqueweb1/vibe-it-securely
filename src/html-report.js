import { spawn } from "node:child_process";
import { RULES } from "./check.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SEV = {
  high: { heading: "Fix these first", badge: "FIX FIRST", cls: "high" },
  medium: { heading: "Should fix", badge: "SHOULD FIX", cls: "medium" },
  info: { heading: "Suggestions", badge: "SUGGESTION", cls: "info" },
};
const ORDER = ["high", "medium", "info"];

const loc = (f) => (f.file ? f.file + (f.line ? ":" + f.line : "") + (f.detail ? " (" + f.detail + ")" : "") : null);

function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.ruleId)) groups.set(f.ruleId, []);
    groups.get(f.ruleId).push(f);
  }
  return groups;
}

function promptFor(rule, locs) {
  const lines = ["Please fix this security issue in my project.", "", "Issue: " + rule.title];
  if (locs.length) lines.push("Where: " + locs.slice(0, 10).join(", ") + (locs.length > 10 ? `, and ${locs.length - 10} more` : ""));
  lines.push("Why it matters: " + rule.why, "What to do: " + rule.fix, "", "Make the smallest change that fixes it, do not change unrelated code, and tell me what you changed.");
  return lines.join("\n");
}

function promptForAll(entries) {
  const lines = ["Please fix these security issues in my project, one at a time, starting with the first. Make the smallest change for each, do not change unrelated code, and tell me what you changed.", ""];
  entries.forEach(({ rule, locs }, i) => {
    lines.push(`${i + 1}. ${rule.title}`);
    if (locs.length) lines.push("   Where: " + locs.slice(0, 10).join(", ") + (locs.length > 10 ? `, and ${locs.length - 10} more` : ""));
    lines.push("   What to do: " + rule.fix, "");
  });
  return lines.join("\n");
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5b6475;--border:#dfe3ea;--high:#c62828;--high-bg:#fdecec;--med:#b26a00;--med-bg:#fff4e0;--info:#1f5fbf;--info-bg:#e8f0fd;--ok:#1b7a3d;--ok-bg:#e6f5ec;--code:#eef0f4}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--card:#1d2129;--text:#e8ebf1;--muted:#9aa3b5;--border:#2d3340;--high:#ff8a80;--high-bg:#3a1f1f;--med:#ffb74d;--med-bg:#392b14;--info:#82b1ff;--info-bg:#1c2a42;--ok:#6fdc8c;--ok-bg:#16301f;--code:#262c37}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 18px 60px}
h1{margin:0 0 4px;font-size:1.7rem}
.sub{margin:0 0 22px;color:var(--muted)}
.verdict{border-radius:14px;padding:18px 20px;margin-bottom:18px;border:1px solid var(--border)}
.verdict h2{margin:0 0 4px;font-size:1.25rem}
.verdict p{margin:0}
.verdict.high{background:var(--high-bg);border-color:var(--high)}
.verdict.medium{background:var(--med-bg);border-color:var(--med)}
.verdict.ok{background:var(--ok-bg);border-color:var(--ok)}
.counts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
.count{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center}
.count b{display:block;font-size:2rem;line-height:1.1}
.count span{color:var(--muted);font-size:.9rem}
.count.high b{color:var(--high)}.count.medium b{color:var(--med)}.count.info b{color:var(--info)}
.how{color:var(--muted);margin:0 0 14px}
button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:8px 14px}
button:hover{border-color:var(--info)}
button.primary{background:var(--info);color:#fff;border-color:var(--info)}
@media (prefers-color-scheme:dark){button.primary{color:#0b1220}}
section.group{margin-top:28px}
section.group h3{margin:0 0 10px;font-size:1.15rem}
article{background:var(--card);border:1px solid var(--border);border-left-width:6px;border-radius:12px;padding:16px 18px;margin-bottom:14px}
article.high{border-left-color:var(--high)}article.medium{border-left-color:var(--med)}article.info{border-left-color:var(--info)}
.badge{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.04em;border-radius:6px;padding:2px 8px;margin-bottom:6px}
.badge.high{background:var(--high-bg);color:var(--high)}.badge.medium{background:var(--med-bg);color:var(--med)}.badge.info{background:var(--info-bg);color:var(--info)}
article h4.title{margin:0 0 10px;font-size:1.08rem}
.label{margin:12px 0 2px;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
article p{margin:0}
code{background:var(--code);border-radius:5px;padding:1px 6px;font:.88rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
ul.where{margin:0;padding-left:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
details summary{cursor:pointer;color:var(--info);margin-top:6px}
.copy{margin-top:14px}
footer{margin-top:34px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--border);padding-top:16px}
footer p{margin:0 0 8px}
@media (max-width:560px){.counts{gap:8px}.count b{font-size:1.6rem}}
`;

const SCRIPT = `
function copyText(text, btn){
  var label = btn.textContent;
  function done(){ btn.textContent = "Copied! Now paste it into your AI assistant"; setTimeout(function(){ btn.textContent = label; }, 2500); }
  function fallback(){
    var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "Copy failed. Select the text manually."; }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, fallback); } else { fallback(); }
}
document.addEventListener("click", function(e){
  var b = e.target.closest("button[data-prompt]");
  if (b) copyText(b.getAttribute("data-prompt"), b);
});
`;

export function renderHtml(result, { projectName = "your project", date = new Date() } = {}) {
  const { findings, filesScanned } = result;
  const groups = groupFindings(findings);
  const counts = { high: 0, medium: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  let verdict;
  if (counts.high) {
    const n = counts.high;
    verdict = { cls: "high", title: `${n} ${n === 1 ? "problem needs" : "problems need"} fixing first`, text: "These are the most serious ones. Start with the red cards below." };
  } else if (counts.medium) {
    const n = counts.medium;
    verdict = { cls: "medium", title: `No urgent problems, but ${n} ${n === 1 ? "thing" : "things"} should be fixed`, text: "Nothing here is an emergency, but each item makes your project safer to fix." };
  } else {
    verdict = { cls: "ok", title: "Nothing found by these checks", text: "That is good news, but it is not a guarantee. These checks only catch common, obvious problems." };
  }

  const entries = [];
  const sections = ORDER.map((sev) => {
    const ids = [...groups.keys()].filter((id) => RULES[id].severity === sev);
    if (!ids.length) return "";
    const cards = ids
      .map((id) => {
        const rule = RULES[id];
        const locs = groups.get(id).map(loc).filter(Boolean);
        if (sev !== "info") entries.push({ rule, locs });
        const shown = locs.slice(0, 5);
        const rest = locs.slice(5);
        const whereHtml = locs.length
          ? `<p class="label">Where</p><ul class="where">${shown.map((l) => `<li><code>${esc(l)}</code></li>`).join("")}</ul>` +
            (rest.length ? `<details><summary>Show ${rest.length} more</summary><ul class="where">${rest.map((l) => `<li><code>${esc(l)}</code></li>`).join("")}</ul></details>` : "")
          : "";
        return `<article class="${SEV[sev].cls}">
  <span class="badge ${SEV[sev].cls}">${SEV[sev].badge}</span>
  <h4 class="title">${esc(rule.title)}</h4>
  ${whereHtml}
  <p class="label">Why it matters</p><p>${esc(rule.why)}</p>
  <p class="label">How to fix it</p><p>${esc(rule.fix)}</p>
  <div class="copy"><button data-prompt="${esc(promptFor(rule, locs))}">Copy a fix request for my AI assistant</button></div>
</article>`;
      })
      .join("\n");
    return `<section class="group"><h3>${SEV[sev].heading}</h3>\n${cards}\n</section>`;
  }).join("\n");

  const allBtn = entries.length
    ? `<p><button class="primary" data-prompt="${esc(promptForAll(entries))}">Copy one fix request for everything below</button></p>`
    : "";
  const notes = (result.notes || []).map((n) => `<p>${esc(n)}</p>`).join("");
  const when = date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security check: ${esc(projectName)}</title>
<style>${CSS}</style>
</head><body><main>
<h1>Security check</h1>
<p class="sub"><strong>${esc(projectName)}</strong> &middot; ${filesScanned} files scanned &middot; ${esc(when)}</p>
<div class="verdict ${verdict.cls}"><h2>${esc(verdict.title)}</h2><p>${esc(verdict.text)}</p></div>
<div class="counts">
  <div class="count high"><b>${counts.high}</b><span>Fix first</span></div>
  <div class="count medium"><b>${counts.medium}</b><span>Should fix</span></div>
  <div class="count info"><b>${counts.info}</b><span>Suggestions</span></div>
</div>
${entries.length ? `<p class="how">Each card shows where the problem is, why it matters and how to fix it. The copy buttons make a ready-to-paste request for your AI assistant (Claude, ChatGPT, Cursor and others).</p>${allBtn}` : ""}
${sections}
<footer>
${notes}
<p>This is a baseline check, not a security audit. A clean result does not mean your project is secure.</p>
<p>Think something is a false alarm? Add the comment <code>vibe-it-securely-ignore</code> to that line, or list the file in <code>.vibe-it-securely-ignore</code>. If a real secret was found, change it at its provider first. Deleting it from the code is not enough.</p>
</footer>
</main><script>${SCRIPT}</script></body></html>
`;
}

/** Opens a file in the default browser. Resolves true if the opener started, false if it could not. */
export function openInBrowser(file) {
  return new Promise((resolve) => {
    let cmd, args;
    if (process.platform === "win32") {
      cmd = "rundll32";
      args = ["url.dll,FileProtocolHandler", file];
    } else if (process.platform === "darwin") {
      cmd = "open";
      args = [file];
    } else {
      cmd = "xdg-open";
      args = [file];
    }
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
