---
name: positron-python-upstream-merge
description: Use when merging a new microsoft/vscode-python release into extensions/positron-python, working through the monthly "INTERNAL: Python maintenance" checklist issue, or refreshing positron-python's pinned Python requirements, ipykernel bundle, or PET version.
---

# positron-python upstream merge

`extensions/positron-python` is a fork of [microsoft/vscode-python](https://github.com/microsoft/vscode-python). Each maintenance round applies the upstream diff between two release tags as one commit, then updates dependencies and CI. The risky part is not the conflicts. It is upstream behavior changes that land cleanly in code Positron depends on. So triage comes before applying, and behavior decisions go to the user.

Scripts are in `.claude/skills/positron-python-upstream-merge/scripts/` (below: `$S`). Run them from the repo root on the user's feature branch. From step 2 on, the tree must be clean.

## Inputs

- `START`: the last upstream tag that was merged. Get it from the maintenance issue, or the title of the previous "upstream merge vX" PR. `package.json`'s version is `2026.99.0-dev` and does not tell you.
- `END`: the new upstream release tag.
- Earlier rounds may have cherry-picked some upstream commits (for example dependabot bumps) past `START`. The 3-way merge handles them: files come out `ALREADY_UPSTREAM`, or conflict only where Positron has an older version of the same bump.

## Workflow

### 1. Preview and triage (no changes to the tree)

```bash
bash $S/preview.sh START END [path-to-local-vscode-python-clone]
```

The script fetches the tags into `refs/vscode-python/*` (kept for `apply.sh`) and prints per-status counts and a report dir:
- `files.tsv`: each upstream-changed file as `CLEAN`, `AUTOMERGE[...]`, `CONFLICT[...]`, `NEW`, `LOCKFILE_KEPT`, and so on, with the count of Positron blocks in our copy.
- `commits.txt`: upstream commits that touch files with Positron blocks. Read every one with `git show <sha>` and look at its commit message, which often explains the reason.

`commits.txt` only covers files with Positron blocks. Also review these, which it can't flag:
- `git diff refs/vscode-python/START refs/vscode-python/END -- package.json build/ python_files/` covers dependencies, contributions, test requirements, and the Python adapters.
- `NEW` files and `AUTOMERGE[...positron_blocks=0]` files under `src/client/` that Positron code calls. Use `rg` from `src/client/positron/` to find out.

For each change, find the Positron callers of what it changes, especially in `src/client/positron/`. Then put it in one of these groups:

| Group | Typical areas |
|---|---|
| **High**: changes behavior that Positron code depends on | `interpreterService` / `getActiveInterpreter` (`positron/manager.ts` starts a session from its result after `onDidChangeInterpreter`), new callers of `_onConfigChanged()` with no scope (Positron then defaults to `startSession: true`), `activationManager`, `nativePythonFinder` (PET), installers, `python_files/posit` kernel deps |
| **Medium**: build, toolchain, or CI | TypeScript, `@vscode/test-electron`, webpack plugins, `build/test-requirements.txt`, upstream `.github/` changes |
| **Low**: inert in Positron | Environments extension (`useEnvExtension()` is forced to `false`), `PYTHONSTARTUP`/`pythonrc.py`/PyREPL (forced off in `terminals/pythonStartup.ts`), native REPL, Pylance-only paths, chat tools hidden with `"when": "false"`, telemetry |

A "Low" area can stop being inert. Check that the Positron override still exists before you rely on it.

**STOP and report to the user** with the groups, a recommendation for each High item (take upstream, keep Positron behavior, or adapt), and a list of manual validation areas. Wait for their decisions before you apply.

### 2. Apply

```bash
bash $S/apply.sh START END
```

This runs `git diff | git apply --3way` into the subdirectory, keeps Positron's `package-lock.json`, and deletes new upstream files that Positron's `.gitignore` excludes (build artifacts). Conflicted files keep their markers.

### 3. Resolve conflicts

| Situation | Resolution |
|---|---|
| `package.json` `version` / `description` | Keep Positron's |
| Positron has an older version of the same bump (npm dep, action version, pinned requirement) | Take upstream |
| `extensions/positron-python/.github/**` | Take upstream. These files don't run in Positron CI; they are the reference for step 6 |
| Upstream edits lines inside a Positron block | Keep the Positron block. If the block holds commented-out upstream code, update that copy to the new upstream code so the next merge diffs cleanly |
| Upstream adds lines next to a Positron block | Keep both |
| Upstream removes code that a Positron block only existed to override | Take upstream and delete the Positron block that no longer has a purpose |
| A High item the user decided to keep in Positron | Implement it inside `// --- Start Positron ---` / `// --- End Positron ---` with a comment that explains why |

`AUTOMERGE` files with `positron_blocks>0` merged silently. Read their diff too (`git diff HEAD -- <file>`): a clean textual merge can still change behavior around a Positron block.

Then run `bash $S/check-markers.sh` and fix everything it reports.

### 4. Commit the merge as positron-bot

```bash
GIT_AUTHOR_NAME="positron-bot[bot]" GIT_AUTHOR_EMAIL="173392469+positron-bot[bot]@users.noreply.github.com" \
GIT_COMMITTER_NAME="positron-bot[bot]" GIT_COMMITTER_EMAIL="173392469+positron-bot[bot]@users.noreply.github.com" \
git commit -m "vscode-python changes from START to END"
```

Put everything after this in separate commits under the user's name.

### 5. Rebuild and verify (commit: "update deps")

In `extensions/positron-python`:
1. `npm install` to regenerate the lockfile. Check whether each npm `overrides` entry in `package.json` is still needed (`npm ls <pkg>`).
2. `npx tsc -p ./ --noEmit`, then `npm run lint` and `npm run format-check`. Fix with `npm run format-fix`. Never use the repo-root `scripts/format.mts`, which uses tabs; this extension uses 4 spaces.
3. `npx tsc -p ./` (the unit tests run from `out/`), then `npm run test:unittests`. Narrow it with `-- --grep` while you iterate, and run everything at the end. Only `*.unit.test.ts` files run here; other `*.test.ts` files run in CI's extension-host job.
4. Python: `./scripts/check-python-quality.sh`; pytest in `python_files/posit`; `python python_files/tests/run_all.py` (CI runs `uv run --active python_files/tests/run_all.py`) if upstream changed the `python_files/` adapters. For the last one, mirror the `positron-python-ci.yml` job: `requirements.txt` installed with `pip -t python_files/lib/python`, then `build/test-requirements.txt`. Move the old `python_files/lib/python` to the Trash first: `pip -t` without `--upgrade` skips existing package directories and leaves old code next to new metadata.

### 6. Mirror upstream CI into Positron (commit: "fix ci")

Compare `git diff refs/vscode-python/START refs/vscode-python/END -- .github/` with `.github/workflows/positron-python-ci.yml` (repo root). Port the changes that affect what gets tested: Python or pytest versions, install order, test dependencies, timeouts. Keep the existing action pinning style of the Positron workflow.

### 7. Dependencies (the remaining checklist items)

- **PET:** compare `positron.externalDependencies.pet` in `package.json` with `gh release list --repo posit-dev/positron-pet-builds` and the newest `release/*` branch of `microsoft/python-environment-tools`. If upstream has a newer release without a Positron build, tell the user. Do not trigger the positron-builds workflow yourself.
- In `extensions/positron-python`: `(cd python_files/posit && uv lock --upgrade)`, `uv run scripts/pip-compile-ipykernel.py`, and the command in `python_files/positron_requirements/requirements.in`. Leave `python_files/jedilsp_requirements` alone; it is an upstream file.
- Use the exact command written in `requirements.in` (it redirects with `>`), so the generated header only changes where the Python version changes.
- From the repo root: `uv run $S/req_diff.py <commit-before-step-7>`. The root `requirements.txt` (installed into `python_files/lib/python`), `ipykernel_requirements`, and `positron_requirements` rows ship to users; `uv.lock` is the test environment. The ipykernel bundle goes on the kernel's `PYTHONPATH` ahead of the user's site-packages, so a bundled major bump replaces the user's version too. Constrain it in `scripts/pip-compile-ipykernel.py` if common libraries exclude the new major. For each shipped `MAJOR` row, read the package changelog, check how `python_files/posit` uses the package, and add it to the PR's validation list. Also check that Positron code doesn't import a package that left the bundle.
- Run the kernel tests the way the `positron-ipykernel-tests` CI job does: `uv pip install pip` in each environment (`vendor.py` calls `python -m pip`), `uv run scripts/vendor.py` once (concurrent runs race on `_vendor/`), then for each Python version, `uv sync --active --inexact --frozen --project python_files/posit` and `pytest python_files/posit`. Include the oldest supported Python: its lock resolves closest to the bundled versions. If a requirements header still names a Python version Positron dropped, that is why this round's bump is large.

### 8. PR

Draft the PR body as a markdown file in the working directory. Do not post it without asking. Include: the upstream range and issue link, the user's decisions on High items, the MAJOR dependency jumps, the manual validation areas from step 1, and e2e tags (use the positron-pr-helper skill).

## Common mistakes

- Treating a clean apply as a safe merge. The behavior changes are usually in `AUTOMERGE` files and in commits whose code merged cleanly.
- Taking upstream startup or performance shortcuts (timeouts, cached or last-known values, listeners that do nothing in VS Code) without checking callers in `src/client/positron/`. Positron starts runtime sessions from interpreter events, which VS Code does not do.
- Leaving the commented-out upstream copy inside a Positron block stale.
- Formatting extension files with the repo-root formatter.
- Bundling ipykernel or ipython major bumps without kernel tests and e2e coverage (Console, Variables, Plots, Help, debugging).
