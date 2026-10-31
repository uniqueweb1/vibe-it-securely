# Contributing to vibe-it-securely

Thanks for helping! This tool is for people who build fast with AI coding tools and are not sure whether the result is safe. Many of them are beginners, and that shapes how we make decisions.

You do not need to be a security expert to contribute. Good bug reports, clearer wording and new test cases are as valuable as code.

## Ways to contribute

- **Report a false alarm or a miss.** This is the most useful contribution. See [Reporting a false alarm or a miss](#reporting-a-false-alarm-or-a-miss).
- **Improve the wording.** Every finding should make sense to someone who has never heard of "XSS" or "SQL injection".
- **Add or improve a check.** See [Adding a new check](#adding-a-new-check).
- **Support another language or package manager.**
- **Improve the docs and tests.**

Ideas we would welcome (check the open issues first, in case someone is already on it):

- Detect exposed source maps in production builds
- SARIF output, so findings show up in GitHub's Security tab
- Read dependencies declared in `setup.py` / `setup.cfg` for the `--online` check
- A tested audit step for Poetry-native projects
- Yarn Berry (`yarn npm audit`) in the generated CI workflow
- Pinning third-party GitHub Actions to commit SHAs in generated workflows

## Getting set up

You need Node.js 18 or newer.

```bash
git clone https://github.com/uniqueweb1/vibe-it-securely.git
cd vibe-it-securely
npm test
```

There is nothing to install. The tool has **no runtime dependencies** and tests use Node's built-in test runner.

Run your local copy against any project without publishing anything:

```bash
node bin/cli.js check --dir /path/to/a/project
node bin/cli.js report --dir /path/to/a/project --out report.html --no-open
node bin/cli.js init --dir /path/to/a/project --dry-run
```

On Windows, use a path like `C:\path\to\project`.

## How the code is organised

| File | What it does |
|---|---|
| `bin/cli.js` | The command line: `init`, `check` and `report` |
| `src/check.js` | The `RULES` (title, why, fix for every finding) and the scanners |
| `src/vibe.js` | Checks aimed at AI-built apps: route login checks, Supabase keys, row level security |
| `src/deps.js`, `src/pydeps.js` | `--online` check that dependency names really exist, and the readers for `package.json`, `requirements.txt`, `pyproject.toml` and `Pipfile` |
| `src/detect.js` | Finds projects, including monorepos with `frontend/` and `backend/` folders |
| `src/init.js`, `src/templates.js`, `src/safe-write.js` | Generates the setup files and never overwrites existing ones |
| `src/report.js`, `src/html-report.js` | Terminal output and the web page report |
| `test/` | One test file per area, using `node:test` |

## Principles

These matter more than any single feature. A change that breaks one of them will be asked to change.

1. **Few false alarms.** A tool that cries wolf gets uninstalled. Only high-confidence problems should be `high` (they block CI). Heuristics are `medium` or `info`. When unsure, prefer missing a finding over inventing one.
2. **Plain language.** Every rule explains what is wrong, why it matters and how to fix it, in words a beginner understands.
3. **Never print secret values.** Reports show where a secret is, never what it is.
4. **Never overwrite the user's files.** If a file exists, write a `.suggested` copy instead.
5. **No surprises.** Nothing touches the network unless the user passes `--online`. Nothing runs on install.
6. **Zero runtime dependencies.** A security tool should have a very small supply chain. If you think a dependency is justified, open an issue first to discuss it.
7. **Honest scope.** This is a baseline check, not an audit. Do not word things as if a clean result means a project is secure.

## Adding a new check

1. **Add the rule** to the `RULES` object in `src/check.js`:

   ```js
   "my-new-rule": {
     severity: "medium",            // "high", "medium" or "info"
     title: "A short, plain description of the problem",
     why: "What can go wrong, in one or two plain sentences.",
     fix: "What to do, concretely. Say what to run or change.",
   },
   ```

2. **Add the detection**, either as a line pattern (see `SECRET_PATTERNS`, `JS_PATTERNS`, `PY_PATTERNS`) or as a function that calls `add("my-new-rule", file, line)`.
3. **Add tests** (see below). Cover real problems, safe look-alikes that must not be flagged, and the ignore comment.
4. **Update the list of checks** in `README.md`.

Things to keep in mind:

- Checks skip test files for the risky-code and generic password rules (tests often contain fake values and unsafe snippets). High-confidence secrets are still reported everywhere.
- Users can silence a line with the comment `vibe-it-securely-ignore`, or whole paths with a `.vibe-it-securely-ignore` file. Make sure your check respects the comment.
- Choose severity honestly. If your pattern can match harmless code, it is not `high`.

## Writing tests

Tests live in `test/` and run with `npm test`.

- Use temporary folders (`fs.mkdtempSync`) and write the files your test needs. Do not depend on files outside the test.
- **Build fake secrets at runtime.** Never write something that looks like a real key as a literal in a test file, because secret scanners will flag it (this has happened to us). For example:

  ```js
  const FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE";
  ```

- For network features, pass a fake `fetchImpl` instead of calling real registries.
- Add a test for the case that should **not** be flagged. False alarms are bugs.

## Reporting a false alarm or a miss

Open an issue and include:

- The rule title shown in the report (for example "Raw HTML is inserted into the page")
- The **smallest code snippet** that reproduces it
- Whether it was a false alarm (flagged but harmless) or a miss (a real problem it did not find)
- Your OS and Node version (`node --version`)

**Never paste real secrets, tokens or the contents of a real `.env` or `.npmrc`.** Replace them with obvious fakes. If you accidentally posted a real one, revoke it right away. Editing the issue does not remove it from the history.

## Reporting a security problem in this tool

If you find a vulnerability in vibe-it-securely itself, for example a way to make it write outside the project folder, leak a secret value or run code, please do not open a public issue with the details. Use GitHub's private vulnerability reporting (the repository's **Security** tab, then **Report a vulnerability**) if it is enabled. If it is not, open an issue that says you have a security report, without technical details, and ask for a private way to share it.

## Pull requests

Small, focused pull requests are easiest to review. Before opening one, check that:

- [ ] `npm test` passes
- [ ] The tool still scans itself cleanly: `node bin/cli.js check --fail-on medium`
- [ ] New or changed behaviour has tests, including a test for what must not be flagged
- [ ] `README.md` is updated if the user-visible behaviour changed
- [ ] You added no runtime dependencies
- [ ] No secrets, tokens or `.npmrc` / `.env` files are in your changes. Run `git status` before committing.

Use a clear commit message that says what changed and why. If your change fixes a false alarm, say which rule and what it wrongly flagged.

## Releases

Maintainers publish to npm, and releases are batched, so a merged pull request will not always appear on npm immediately. Contributors do not need to bump the version number or publish anything.

## Code style

- Plain modern JavaScript (ES modules), no build step.
- Keep functions small and comments focused on *why*, not *what*.
- Match the existing style in the file you are editing.

## Be kind

Many people who use this tool are new to programming and to security. Be patient and welcoming in issues and reviews. Assume good intentions.
