# secure-baseline

A security baseline for JavaScript, TypeScript and Python projects, set up with one command.

Built for people who build fast with AI coding tools and are not sure whether the result is safe.

> **Honest scope:** this sets up a *baseline* and finds *common, obvious* problems. It reduces risk. It does not make a project secure, and a clean report is not a security audit.

## Quick start

```bash
npx secure-baseline init     # generate the baseline files
npx secure-baseline check    # find problems, explained in plain language
```

Requires Node 18+. No dependencies.

## `init`: set up the safeguards

Detects your stack (JS, TS, Python, or a mix; npm, pnpm or yarn) and generates:

| File | Purpose |
|---|---|
| `.pre-commit-config.yaml` | Fast local checks: secret scanning and private-key detection before every commit |
| `.github/workflows/security.yml` | The same checks in CI, plus dependency audit and static analysis. CI is the real enforcement, because local hooks can be skipped with `--no-verify` |
| `Dockerfile`, `.dockerignore` | Multi-stage build, non-root user, no secrets copied in (skip with `--no-docker`) |
| `AGENTS.md` | Security rules for AI coding assistants (copy to `CLAUDE.md` or `.cursorrules` if your tool needs that name) |
| `.env.example`, `.gitignore` | Created only if missing |

**It never overwrites your files.** If one already exists, the new version is saved as `<name>.suggested` for you to review and merge.

Options: `--dir <path>`, `--dry-run`, `--no-docker`.

After `init`: `pip install pre-commit && pre-commit install`.

### What blocks and what only warns

To avoid false alarms that make people turn the tool off, only high-confidence problems block CI: committed secrets, private keys, and critical dependency vulnerabilities. Everything else is reported as a warning.

## `check`: find problems

```bash
secure-baseline check [--dir <path>] [--fail-on high|medium|none] [--json]
```

Looks for:

- **Leaked secrets:** private keys; AWS, GitHub, Slack and AI-provider keys; hardcoded passwords and tokens
- **`.env` mistakes:** committed to git, or not covered by `.gitignore`
- **Risky code:** `eval`, SQL built by joining text, raw HTML insertion, wide-open CORS, turned-off HTTPS checks, `shell=True`, `yaml.load`, `pickle`, debug mode left on
- **Docker problems:** running as root, unpinned images, secrets in `ENV`/`ARG`, `.env` copied into the image
- **Missing safeguards:** pre-commit hooks, CI, lockfile, AI-assistant rules

Every finding says **where** it is, **why** it matters and **how** to fix it. Secret values are never printed.

The exit code is `1` if anything at or above `--fail-on` (default `high`) is found, so it works as a CI gate.

### Silencing false alarms

- On one line: add the comment `secure-baseline-ignore`
- For whole files or folders: list them in `.secure-baselineignore` (one path per line, `#` for comments)

```
# .secure-baselineignore
test/fixtures/
```

## Limitations

- `check` uses pattern matching, not deep code analysis. It misses things and sometimes flags harmless code. The generated CI workflow adds Semgrep and gitleaks for deeper coverage.
- It does not check your dependency versions itself. That is done by `npm audit` / `pip-audit` in the generated CI workflow.
- Generated Dockerfiles guess your start command. Review the `TODO` comments in them.
- Review generated files before relying on them. Pin third-party GitHub Actions to commit SHAs for stronger supply-chain safety.

## Development

```bash
npm test
```

## License

MIT
