# vibe-it-securely

A security baseline for JavaScript, TypeScript and Python projects, set up with one command.

Built for people who build fast with AI coding tools and are not sure whether the result is safe.

> **Honest scope:** this sets up a *baseline* and finds *common, obvious* problems. It reduces risk. It does not make a project secure, and a clean report is not a security audit.

## Quick start

Run it without installing anything:

```bash
npx @uniqweb/vibe-it-securely init      # generate the baseline files
npx @uniqweb/vibe-it-securely report    # find problems and show them as an easy-to-read web page
```

Prefer the terminal? Use `check` instead of `report`:

```bash
npx @uniqweb/vibe-it-securely check     # same checks, plain text in the terminal
```

Or install it into your project and use the short command name:

```bash
npm i -D @uniqweb/vibe-it-securely
npx vibe-it-securely init
npx vibe-it-securely report
```

Requires Node 18+. No dependencies.

> The package is published under the `@uniqweb` scope, so always include it in the `npx` / `npm i` commands. Once installed, the command itself is just `vibe-it-securely`.

## Starting a brand-new project

`init` works best at the very start, before you write any code, because `AGENTS.md` tells your AI assistant the security rules before it writes anything.

```bash
mkdir my-app && cd my-app
git init
npx @uniqweb/vibe-it-securely init --stack ts      # or: --stack js, --stack python, --stack ts,python
pip install pre-commit && pre-commit install
```

`--stack` is only needed in an empty folder. If you already created the project with a starter (Vite, Next.js, a Python template and so on), `init` detects it by itself. Create `package.json` (`npm init -y`) or `requirements.txt` afterwards so the CI dependency checks have something to audit.

## `init`: set up the safeguards

Detects your stack (JS, TS, Python, or a mix; npm, pnpm or yarn) and generates:

| File | Purpose |
|---|---|
| `.pre-commit-config.yaml` | Fast local checks: secret scanning and private-key detection before every commit |
| `.github/workflows/security.yml` | The same checks in CI, plus dependency audit and static analysis. CI is the real enforcement, because local hooks can be skipped with `--no-verify` |
| `Dockerfile`, `.dockerignore` | Only with `--docker`: multi-stage build, non-root user, no secrets copied in |
| `AGENTS.md` | Security rules for AI coding assistants (copy to `CLAUDE.md` or `.cursorrules` if your tool needs that name) |
| `.env.example`, `.gitignore`, `.gitleaksignore` | Created only if missing |

**Monorepos are supported.** If your repository holds several projects (for example `frontend/` and `backend/`), `init` finds them in subfolders up to 3 levels deep. Repository-wide files (pre-commit, CI, `AGENTS.md`) go in the root, Docker files (with `--docker`) go next to each project, and the CI runs each project's dependency audit from the right folder.

**It never overwrites your files.** If one already exists, the new version is saved as `<name>.suggested` for you to review and merge.

```bash
npx @uniqweb/vibe-it-securely init [--dir <path>] [--dry-run] [--stack js|ts|python] [--docker]
```

Options: `--dir <path>`, `--dry-run` (preview without writing anything), `--stack js|ts|python` (for a brand-new empty folder, see below), `--docker` (also generate Dockerfiles; off by default because most projects do not need them on day one).

After `init`: `pip install pre-commit && pre-commit install`.

### Secret scan flagged something fake?

The CI secret scan (gitleaks) also looks at your git history, so a fake key in a test file can fail the build. If the value is fake or an example, copy the `Fingerprint:` line from the CI log into `.gitleaksignore` (one per line; `#` starts a comment). Better still, build fake values at runtime in tests so no scanner sees a literal. If the value is real, revoke it and replace it instead.

### What blocks and what only warns

To avoid false alarms that make people turn the tool off, only high-confidence problems block CI: committed secrets, private keys, and critical dependency vulnerabilities. Everything else is reported as a warning.

## `report`: the easy-to-read version

```bash
npx @uniqweb/vibe-it-securely report [--dir <path>] [--online] [--out <file>] [--no-open]
```

Runs the same checks as `check`, then opens a clean web page in your browser:

- A plain-language summary at the top ("1 problem needs fixing first")
- Colour-coded cards for each problem: where it is, why it matters and how to fix it
- A **copy button** on every card, and one for everything, that puts a ready-made fix request on your clipboard so you can paste it into your AI assistant (Claude, ChatGPT, Cursor and others)
- Works on phones and in dark mode, and needs no internet connection to view

The page is saved in your temp folder unless you choose a place with `--out <file>`. If no browser opens (for example on a remote server or in Codespaces), use `--out report.html --no-open` and open the file yourself. The report never contains secret values, only where they are.

## `check`: find problems

```bash
npx @uniqweb/vibe-it-securely check [--dir <path>] [--fail-on high|medium|none] [--json] [--online]
```

(If you installed the package, use `npx vibe-it-securely check ...` instead.)

Looks for:

- **Leaked secrets:** private keys; AWS, GitHub, Slack, npm and AI-provider keys; hardcoded passwords and tokens. A `.npmrc` that holds a login token and is not covered by `.gitignore` is flagged as high, because the next `git add .` would publish it.
- **`.env` mistakes:** committed to git, or not covered by `.gitignore`
- **Risky code:** `eval`, SQL built by joining text, raw HTML insertion, wide-open CORS, turned-off HTTPS checks, `shell=True`, `yaml.load`, `pickle`, debug mode left on
- **Docker problems:** running as root, unpinned images, secrets in `ENV`/`ARG`, `.env` copied into the image
- **Missing safeguards:** pre-commit hooks, CI, lockfile, AI-assistant rules
- **Common AI-app mistakes:**
  - Routes that change data (Express-style, Next.js `app/` and `pages/api`) with no sign of a login check. This is a heuristic, so public routes need the ignore comment.
  - Supabase `service_role` keys in code (including inside JWTs), and secrets exposed to the browser through public env variables such as `NEXT_PUBLIC_*`
  - Supabase tables created without row level security, or with it switched off
- **Invented dependencies** (with `--online`): checks that every package in each project's `package.json` and `requirements.txt` really exists on npm / PyPI. AI tools sometimes make up names, and an attacker can register them. This contacts the public registries, so it is opt-in. Private-registry scopes and network failures are reported as "could not verify", never as findings.

Every finding says **where** it is, **why** it matters and **how** to fix it. Secret values are never printed.

The exit code is `1` if anything at or above `--fail-on` (default `high`) is found, so it works as a CI gate.

### Test files

In test files (`tests/`, `__tests__/`, `*.test.ts`, `*.spec.js`, `test_*.py`, `conftest.py`, fixtures and mocks), the risky-code rules and the generic password/token rule are skipped, because tests often contain deliberately fake values and unsafe snippets. Real-looking cloud, GitHub, Slack and AI-provider keys and private keys are still reported everywhere.

### Silencing false alarms

- On one line: add the comment `vibe-it-securely-ignore`
- For whole files or folders: list them in `.vibe-it-securely-ignore` (one path per line, `#` for comments)

```
# .vibe-it-securely-ignore
test/fixtures/
```

## Limitations

- `check` uses pattern matching, not deep code analysis. It misses things and sometimes flags harmless code. The generated CI workflow adds Semgrep and gitleaks for deeper coverage.
- The route-auth check looks for auth keywords near the route, so it can miss real gaps and flag public routes.
- It does not check your dependency versions itself. That is done by `npm audit` / `pip-audit` in the generated CI workflow.
- Project folders named `test`, `tests`, `fixtures`, `examples`, `node_modules` or `.venv` are not treated as projects, and at most 12 projects are detected.
- Generated Dockerfiles guess your start command. Review the `TODO` comments in them.
- Review generated files before relying on them. Pin third-party GitHub Actions to commit SHAs for stronger supply-chain safety.

## Development

```bash
npm test
```

## License

MIT
