---
name: positron-pull-vscode-server
disable-model-invocation: true
description: Use when pulling changes from rstudio/vscode-server into Positron — fetching upstream, triaging commits, and applying diffs
---

# Pull Upstream vscode-server Changes

Ports changes from `rstudio/vscode-server` into Positron as a single "upstream merge from vscode-server" commit. A full `git merge` is not possible — the two repos are parallel VSCode forks with no shared git ancestry — so changes are applied manually and bundled into one commit.

## When to Use This Skill

Use this skill when:
- Pulling new bug fixes or features from `rstudio/vscode-server` into Positron
- Deciding which upstream commits are relevant to port

## Prerequisites

The upstream remote must be configured:
```bash
git remote -v   # should show: upstream → git@github.com:rstudio/vscode-server.git (push disabled)
```

## Workflow

### Step 1: Fetch and enumerate

Use the helper script to fetch upstream and list candidates in one shot:

```bash
.claude/skills/positron-pull-vscode-server/scripts/enumerate-upstream.sh <baseline-sha>
```

Find `<baseline-sha>` — it's the `upstream/main` HEAD recorded after the previous run. After each run, note it for next time:

```bash
git rev-parse upstream/main
```

If starting fresh with no recorded SHA, look at the `Brings in:` lines of the last upstream merge commit, find the earliest of those commits on `upstream/main`, and use its parent SHA as the baseline.

The script assumes Positron and vscode-server are on the same Microsoft VSCode baseline. If Microsoft commits appear in the range it exits with an error — sync the Microsoft baseline first.

The script outputs all new commits on `upstream/main` since the baseline, with file stats per candidate.

### Step 2: Triage

For each candidate, `git show <SHA>` to read the full diff, then port it unless:
- CI-only (`Jenkinsfile`, `jenkins/`, `.github/` only)
- vscode-server-specific build/deploy tooling with no Positron equivalent

### Step 3: Apply diffs manually

Do **not** cherry-pick — line numbers differ between the repos and cherry-pick conflicts are harder to resolve than manual application.

```bash
git show <upstream-SHA>   # read the diff
# open the Positron file and apply the equivalent change
```

**Marker rules:**
- **PWB markers** (`// --- Start PWB: ... ---` / `// --- End PWB ---`): copy exactly as they appear in the upstream diff. Do not rename them to Positron markers.
- **Positron markers** (`// --- Start Positron ---` / `// --- End Positron ---`): use only when Positron needs to add or change something *on top of* the PWB change. Do not use them to wrap changes that came from vscode-server.

### Step 4: Verify and commit

```bash
npm run build-check                                # zero TypeScript errors
npm run precommit -- <file1> <file2> ...           # lint and formatting
```

Fix precommit issues only in lines you touched. Do not fix pre-existing warnings in unrelated parts of the file — those belong in a separate commit.

Bundle everything into one commit. Keep the message focused on what's being ported and why — do not include QA notes or e2e test tags (those belong in the PR body only):
```bash
git commit -m "upstream merge from vscode-server

Brings in:
- rstudio/vscode-server#N: <description>

<optional: 1-2 short paragraphs of context, e.g. who/what is affected>"
```

### Step 5: Offer to create PR

After the commit lands and verification passes, ask the user whether to create a PR using the `positron-pr-helper` skill — do not push or open the PR until they confirm.

If they say yes, invoke `positron-pr-helper`. Always include `@:workbench @:web @:jupyter` in the QA tags. Then look at the ported diffs and add any other tags that match the affected areas — `positron-pr-helper` fetches the current list from `test/e2e/infra/test-runner/test-tags.ts` (or run `.claude/skills/positron-pr-helper/scripts/fetch-test-tags.sh list` directly). Pick tags conservatively — only add ones that genuinely match what changed. The mandatory three (`@:workbench @:web @:jupyter`) already cover the PWB surface area; additional tags are for routing extra coverage at the specific subsystem that was touched.

### Step 6: Ask for skill feedback

After the PR is open (or after the user declines to create one), ask the user how the skill worked for them and whether anything about the workflow should be changed. If they suggest changes, edit `SKILL.md` directly so future runs incorporate the feedback.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Renaming `// --- Start PWB: ... ---` to `// --- Start Positron ---` | Keep PWB markers exactly as upstream. Positron markers are only for additions on top. |
| Cherry-picking instead of applying diffs manually | No shared git ancestry — cherry-pick conflicts are worse than manual application |
| Fixing pre-existing lint warnings in unrelated lines | Only fix issues in code you actually changed |
