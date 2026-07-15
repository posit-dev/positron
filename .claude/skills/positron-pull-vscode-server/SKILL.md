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

This skill ports across a **shared** Microsoft VSCode baseline. Two independent signals indicate the baseline relationship:

- **Version/distro parity (the reliable signal):** compare `version` and `distro` in `package.json` on `main` vs `upstream/main`. If both match, the repos share a baseline — proceed. A `Merge 1.NNN.0` / `Merge rel-*` commit in the range is then a *reconciliation* merge that brought vscode-server up to the baseline Positron already has; skip the merge itself but still port the feature/bugfix PRs interleaved around it. If `version` or `distro` differ, the repos have diverged — stop and sync the Microsoft baseline before porting anything.
- **Microsoft-author commits (coarse backstop):** the enumerate script also errors out if Microsoft-authored commits appear in the range. This catches obvious divergence but is not authoritative — a baseline can differ without a Microsoft-authored commit landing in the exact range, which is why the version/distro check above is the one to trust.

The script outputs all new commits on `upstream/main` since the baseline, with file stats per candidate.

### Step 1b: Check the backlog when the user names a single PR/issue

If the user asks to pull one specific PR or issue (rather than "pull everything new"), run the backlog check before porting it. The single requested PR is rarely the only thing waiting upstream, and silently porting just that one leaves the rest of the backlog undiscovered.

```bash
.claude/skills/positron-pull-vscode-server/scripts/check-backlog.sh
```

The script auto-derives the baseline from the most recent "upstream merge from vscode-server" commit (searching all refs, since that merge often lives on a dedicated `pull-vscode-server` branch, not `main`). Pass an explicit `<baseline-sha>` to override.

The script already filters two classes of merge so they are never candidates:

- **Microsoft baseline merges** (`Merge 1.NNN.0 from upstream`, `Merge rel-*`, `merge/1.NNN.0` branches). These are reconciliation merges that bring vscode-server up to a Microsoft VSCode baseline Positron tracks independently. They are not portable PRs, are never considered, and must not appear in the PR body's "Considered but not included" list.
- **`update-extension-*` (rstudio.rstudio-workbench) bumps when Positron is not behind.** The script compares the `rstudio.rstudio-workbench` version in `product.json` on `main` vs `upstream/main`. If Positron's version is equal or newer, the bump is already covered and is dropped. Only when Positron is *behind* does the script keep `update-extension-*` as a candidate worth considering.

It then lists the remaining candidate merges and prints triage guidance. For those:

1. **Confirm the baseline is shared** using the version/distro parity check from Step 1. A mismatch means stop and sync the baseline first (the script's baseline-merge filter assumes a shared baseline).
2. **Triage the remaining merges.** `version-bump` and `.github/`/`Jenkinsfile`-only PRs are vscode-server tooling — skip. What's left is portable source changes.
3. **Check direction before assuming a PR is missing.** Some vscode-server PRs originated in posit-dev/positron and were *back*ported upstream, so they already exist in Positron. Before listing a PR as portable, confirm Positron doesn't already have the change (grep for the touched symbol/file, or check the upstream PR description for a "ported from positron" note).
4. **Surface the full portable list to the user** and ask whether to port just the requested PR or sweep the others in too. Don't decide for them.

Keep a short record of every *candidate* PR you triaged but did **not** port and the one-line reason (tooling-only, back-ported and already in Positron, user scoped it out, etc.). This record feeds the PR body in Step 5. Do **not** record the filtered-out baseline merges — they were never candidates.

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

`format.mts` (run in Step 4) may re-indent a marker comment to match its surrounding scope — e.g. an `// --- End PWB ---` placed just before an array element gets indented one level deeper than it sits in the upstream diff. That is correct: let the formatter win on indentation. "Copy exactly" governs the marker text and placement, not whitespace the formatter owns.

### Step 4: Verify and commit

```bash
npm run build-ps                                   # check daemon status; if watch-client is stopped, run build-start first
npm run build-check                                # TypeScript errors
npm run precommit -- <file1> <file2> ...           # lint and formatting
```

The TypeScript-checking daemon (`watch-client`) is often stopped; `build-check` only reports the latest cycle, so start the daemons with `npm run build-start` before relying on its output.

`build-check` reports errors across the whole project, including pre-existing failures in extensions you didn't touch (e.g. `positron-data-driver-duckdb` "Cannot find module" errors from build ordering). Verify the **files you ported** compile clean; ignore pre-existing errors in untouched code.

Fix precommit issues only in lines you touched. Do not fix pre-existing warnings in unrelated parts of the file — those belong in a separate commit. Before committing, run `git status` and exclude any unrelated churn a build daemon may have introduced (e.g. line-ending rewrites in a `package-lock.json` you never opened) — `git checkout -- <file>` to drop it.

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

Keep the PR body lean. Lead with `Fixes #<positron-issue>` and a one-line "Upstream merge from vscode-server, bringing in rstudio/vscode-server#N." Do **not** restate the problem and solution — the linked Positron issue already describes the problem and the upstream PR already describes the fix. Restating them just duplicates the issue.

The PR body must include a "Considered but not included" section listing the candidate PRs from the Step 1b backlog that were triaged but left out. Format it as a two-column table: the **reason** in the first column, the vscode-server PRs as a `<ul><li>…</li></ul>` bullet list in the second (group PRs that share a reason into one row). GitHub-flavored markdown does not render native list syntax inside a table cell, so use inline `<ul>`/`<li>` tags.

```markdown
Other commits on `upstream/main` since the last pull (#<positron-merge-pr>) were triaged and left out:

| Reason | Commits |
| --- | --- |
| Already implemented in Positron (#<positron-pr>) | <ul><li>rstudio/vscode-server#NNN (short description)</li></ul> |
| rstudio.rstudio-workbench bumps; Positron's `product.json` already pins a newer version | <ul><li>rstudio/vscode-server#NNN</li><li>rstudio/vscode-server#NNN</li></ul> |
| CI automation (`.github/` / `Jenkinsfile` only) | <ul><li>rstudio/vscode-server#NNN</li></ul> |
```

Reference rules for the table and the rest of the body:

- Write **every** vscode-server reference fully qualified as `rstudio/vscode-server#NNN`, including each item in a bullet list — a bare `#NNN` on a posit-dev/positron PR auto-links to a Positron issue of that number, mislinking to something unrelated.
- For a PR left out because it was back-ported from Positron, use the reason "Already implemented in Positron (#NNN)" and link the originating Positron PR. Find it in the vscode-server PR body (it usually says "Port of ... from posit-dev/positron#NNN").
- The only bare `#NNN` that belong in the body are genuine Positron references: the issue being fixed, the prior upstream-merge PR, and any "already implemented in Positron" links.
- When referring to "the last pull," link the prior *Positron* upstream-merge PR (e.g. `since the last pull (#13497)`), not a vscode-server PR number. Find it with `gh pr list --repo posit-dev/positron --state merged --search "upstream merge from vscode-server in:title" --limit 1`.

If the backlog was empty (nothing portable beyond what was ported), state that explicitly rather than omitting the section. This makes the scope decision auditable — a reviewer can see the full delta was reviewed, not just the part that landed.

### Step 6: Ask for skill feedback

After the PR is open (or after the user declines to create one), ask the user how the skill worked for them and whether anything about the workflow should be changed. If they suggest changes, edit `SKILL.md` directly so future runs incorporate the feedback.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Renaming `// --- Start PWB: ... ---` to `// --- Start Positron ---` | Keep PWB markers exactly as upstream. Positron markers are only for additions on top. |
| Cherry-picking instead of applying diffs manually | No shared git ancestry — cherry-pick conflicts are worse than manual application |
| Fixing pre-existing lint warnings in unrelated lines | Only fix issues in code you actually changed |
| Porting only the one PR the user named, missing the backlog | Run `check-backlog.sh` (Step 1b) and surface the full portable list before deciding scope |
| Treating `Merge 1.NNN.0` as out-of-scope divergence when baselines match | Compare `version`/`distro` in package.json — matching means it's a reconciliation merge, not a divergence; the PRs around it are still portable |
