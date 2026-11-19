---
name: positron-review
description: Code-reviews a Positron change (PR, branch, range, or local working tree). Runs the built-in /code-review for the general bug hunt, then a short Positron layer that checks what it misses (stated facts and disable reasons, unexplained literals, behavior against the upstream sibling it imitates, enforced settings, saved state, Positron build and platform dimensions), fact-checks the general pass, ranks everything by what users see, and saves the review to a file. Both passes run in fresh subagents that never see the conversation, so a session that wrote the change still gets a blind review. Use when the user invokes /positron-review or asks for a thorough review of a Positron PR or their local changes. Not for upstream VS Code merges (review-upstream-merge) or for grading test coverage alone (pete).
disable-model-invocation: true
---

# Positron Code Reviewer

You review changes in **posit-dev/positron** and write a review aimed at finding things to change. It has two parts:

1. **The general pass** is the built-in `/code-review`. It is good at correctness bugs, error handling, root `CLAUDE.md` conventions, and duplicated code. It runs in its own subagent and sees only the diff.
2. **The Positron layer** is this skill. It does a few specific checks the general pass reliably misses, then fact-checks the general pass, merges both, and rates everything.

Don't re-hunt generic bugs in the layer; the general pass does that. Spend the layer's effort on the checks in Step 4, done as inventories: list every item of each kind in the diff, then check each one. Earlier versions of this skill had a long hazard checklist; reviewers read it and still skipped the checks that mattered. The inventories exist so a check can't be skipped by judgment.

The Rules at the end bound what you may touch.

## Routing

Point the user elsewhere when the change is:

- An upstream Code OSS merge: `review-upstream-merge`.
- Only test files, for a test-quality review: `review-vitest-tests`.
- A question of whether the PR has *enough* tests: PETE (`pete` locally, the PR Test Checker in CI). This review judges test value, not coverage.

## Inputs

`/positron-review [level] [target] [focus]`

- **Level** (optional): `low`, `medium`, `high`, or `xhigh`, passed to the general pass. Default `high`. Use `max` only when the user asks for it by name.
- **Target**: a PR (URL, `1528`, `#1528`; strip a leading `PR`), a branch name or `A..B` range, or **nothing** (current local work). Ask if it looks truncated or ambiguous.
- **Focus**: any other text. Give it extra scrutiny and address it explicitly, but still do every Step 4 inventory. If it conflicts with the flow ("just a quick pass"), follow it and say in the Summary what you skipped.

## How the review runs

The invoking session often wrote the change or discussed it, and a reviewer carrying that history shares the author's assumptions. So the review runs in fresh subagents; the invoking session only coordinates.

| Who | Does | Sees |
|-----|------|------|
| **Coordinator** (invoking session) | Step 1, the briefs, starts both agents, relays the general pass's findings, posts the digest. Later, triage ("Acting on this review"). | Everything. That is why it doesn't review. |
| **General-pass agent** | Step 2 only. | The range. |
| **Reviewer agent** | Steps 3-6. | The range, the intent sources below, this skill, and the general pass's findings once relayed. |

Do this for every target. Start both agents with the Agent tool, `subagent_type: "general-purpose"`, no `model` override, in the same message so they run in parallel.

**The reviewer's brief** contains exactly:

- Mode, `BASE`, `TARGET` (full SHAs, or "the working tree" in Local mode), and the reading method from Step 1.
- The level and the user's focus text, verbatim.
- Where intent comes from: the PR number (it reads the description and linked issue with `gh`), the issue number, and the commit messages, which it reads itself.
- For uncommitted work or commits with useless messages: at most two neutral sentences on what the change is meant to do, in user terms. Never why it is correct, what was tested, suspected weak spots, or design history.
- The path to this file, `.claude/skills/positron-review/SKILL.md` under the root of the checkout the coordinator runs in (`git rev-parse --show-toplevel`), with the instruction to read it and carry out Steps 3-6 and the Rules.
- Not to read `reviews/`, plan or notes files, or memory files.

Never put the conversation, a summary of it, earlier findings, or a hypothesis in any brief.

**Sequence.**

1. The coordinator runs Step 1.
2. It starts both agents. The reviewer runs Steps 3-4, then **stops** and returns a one-line status saying it is waiting for the general pass.
3. When the general pass returns, the coordinator forwards its report **verbatim** to the reviewer with SendMessage (load the tool if deferred): no commentary, filtering, or ranking. If the general pass failed, say so instead.
4. The reviewer runs Steps 5-6 and returns the 2-4 line digest with the file path.
5. The coordinator posts the digest as it came back. Disagreements belong in triage.

**When agents aren't available,** run every step inline and say so in the Summary. If this session wrote or discussed the change, also say the review was not blind. A subagent started with only a target and no history (a calibration run) is still blind inline.

## Step 1: Resolve the target

Every mode ends with `BASE` and `TARGET`. State both in the Summary.

| Mode | Trigger | Base | Target |
|------|---------|------|--------|
| **PR** | a PR number or URL | merge-base of `origin/<baseRefName>` and the PR head | the PR head commit |
| **Local** | a branch name or no argument | merge-base with `origin/main` | committed + uncommitted + untracked |
| **Range** | `A..B`, or two commits | `A` | `B` |

Never check out the PR: switching branches in a Positron checkout makes the build daemons recompile and risks the user's uncommitted work.

```bash
# PR
gh pr view <n> --json number,title,url,author,body,baseRefName,headRefOid,files
git fetch origin <baseRefName> "pull/<n>/head"
TARGET=<headRefOid>; BASE=$(git merge-base "origin/<baseRefName>" "$TARGET")
# Local
git fetch origin main   # best effort
BASE=$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD)
```

**Reading method.** In PR and Range modes, read files with `git show "$TARGET:<path>"` and search with `git grep -n <pattern> "$TARGET" -- <paths>`; the working tree is a different revision, so don't `Read` or `Grep` it and never cite its line numbers. If `TARGET` is `HEAD` and the tree is clean, the working tree is fine. In Local mode with an explicit branch that isn't current, read it from git objects too. If `BASE == HEAD` and the tree is clean, there is nothing to review. In Range mode, use three-dot diffs only when `A` is an ancestor of `B`. Read repo guidance at `TARGET` as well.

**Stacked PRs.** Review this PR's commits; read the lower PR as far as this change depends on it, and say how far in the Summary. File a finding here even when its fix belongs in another PR of the stack, name that PR, and rate it by its effect once this PR lands.

## Step 2: Run the general pass

The general-pass agent invokes the Skill tool with `skill: "code-review"`, which is Claude Code's built-in `/code-review` (upstream's `.github/skills/code-review` is a Copilot skill that Claude Code doesn't load). Its brief: the args below, "never pass `--fix` or `--comment`, change no files, post nothing", and "return every finding with its file, line, summary, and failure scenario, unedited". Nothing about intent or suspected problems.

- PR and Range: `args: "<level> <BASE>..<TARGET>"` with full SHAs.
- Local with uncommitted or untracked changes: `args: "<level>"`.
- Local with a clean tree: `args: "<level> <BASE>..HEAD"` with full SHAs (a bare level can pick a different base or an empty diff).

`/code-review` runs as a fork in the coordinator's working directory, whatever the brief says. In PR and Range modes that directory usually holds a different revision, so the general pass may cite later code. Step 5 checks its claims at `TARGET`. If you are setting up a calibration run, start the coordinator in a worktree at `TARGET`.

If the general pass can't run or fails, the reviewer does it during Step 4 with the fallback checklist at the end, and says so.

## Step 3: Understand the change

```bash
git log --oneline $BASE..$TARGET
git diff --stat $BASE...$TARGET          # local: git diff --stat $BASE
git diff $BASE...$TARGET -- <paths>      # in path groups
git ls-files --others --exclude-standard # local only
```

**Intent.** Read the PR description, linked issue, and commit messages. If something can't be opened, say so. If you still can't tell what the change is for, state your best reading as assumed and raise a `clarity` finding.

**Triage.** Label mechanical hunks and skim them: lockfiles, generated comms code (check the `positron/comms/*.json` schema changed with it), regenerated snapshots, mass renames, vendored Python pins. Read everything else in behavioral context: the whole enclosing function, its callers, DI and contribution registration, and the tests that exercise it.

**Guidance.** Claude Code loads nested and path-scoped guidance only when it opens a matching file with `Read`, so collect it on purpose, at `TARGET`:

1. Nested `CLAUDE.md` / `AGENTS.md` in a changed file's folder or an ancestor (`git ls-tree -r --name-only $TARGET | grep -E '(^|/)(CLAUDE|AGENTS)\.md$'`). They override the root files for their subtree.
2. `.claude/rules/*.md` whose `paths:` match a changed file. For tests that is at least `vitest-tests.md` and, for DOM or React tests, `vitest-rtl.md`.
3. `.github/instructions/*.instructions.md` whose `applyTo:` matches, or whose topic matches the change (CSS, observables, disposables, accessibility).
4. Checklist skills, read as checklists only (skip any step that runs a tool): `design-philosophy` and `design-tokens.instructions.md` for visual changes, `accessibility` for new or changed UI, `policy-and-managed-settings` for new settings, `review-vitest-tests` for new or rewritten Vitest suites, `author-e2e-tests` for e2e tests, `positron-data-grid-pattern` for data grids.

Where sources conflict, the closer one wins and Positron's wins over upstream's:

| Topic | Upstream says | In Positron code |
|---|---|---|
| Unit tests | Mocha `suite()`/`test()` | New Positron unit tests are Vitest; Mocha only for existing upstream suites and extension-host tests. |
| Assertions | one `assert.deepStrictEqual` snapshot | Vitest uses `expect(...)` and inline snapshots. |
| Copyright | Microsoft header | Posit header on new Positron files. |
| Indentation | tabs | tabs, except TypeScript in `extensions/positron-python` (4 spaces). |
| AI gating | `chat.disableAIFeatures` | `ai.enabled` (`.claude/rules/ai-gating.md`). |
| Reuse | reuse and extend | Changing an upstream file to extend it costs a merge conflict every upstream merge; prefer a Positron file. |
| Punctuation | em-dashes common | ASCII only. |

Keep a coverage note: areas read, guidance used and skipped, the Step 4 inventories, open questions. Disclose anything unread in the Summary.

## Step 4: The Positron layer

Do every inventory below. Write each inventory into the coverage note as a list of items with a one-word result (`ok`, `finding`, `n/a`), so a reader can see nothing was skipped. Cite `file:line` for findings, and re-check each against the code before keeping it.

### 4a. Stated facts

List every new or changed statement in the diff that claims a fact about code or behavior:

- comments and JSDoc that state a number, a computation, an ordering, a guarantee, or what something does or doesn't have;
- the reason text on every `eslint-disable`, `@ts-expect-error`, `@ts-ignore`, or skipped test;
- test names and `describe` text that say what is being shown;
- the PR description's behavior claims and listed limitations ("Not in this PR", "Known issues").

Check each against the code at `TARGET`, including upstream code it describes. Open the class or function it talks about; don't trust the claim. A false statement is a finding. A disable whose reason is false is a finding that also removes the disable: if the reason says something has no role, label, or id, check the rendered element, and if it has one, the test should use it (`vitest-rtl.md`). For a description limitation, trace what really happens in that case. If the effect is wider than stated (the whole session, other users), that is a finding even when deferring the fix is right.

Also flag a comment that says only what a thing isn't, or restates the code, as `minor (clarity)`.

### 4b. Unexplained literals

List every new or changed literal that encodes a size, a duration, a limit, or a count and is not a design token or a named constant with a stated reason: CSS lengths, timeouts, retry counts, debounce delays, buffer sizes, thresholds.

For each, ask where the value comes from, and work it out when you can. For a layout value, add up the elements it makes room for. For an `em` value, compute it at each platform's default font (12px on macOS, 14px on Windows and Linux), and against the element's own `font-size`. For a timeout, ask what the operation does in its slow case, and what actually happens when the timeout fires: does it bound what it claims to bound?

- No derivation: `minor (clarity)`. Ask for a comment or a `calc()` showing it.
- Your computation disagrees with the value: a finding rated by its effect. A padding that is far bigger than what it makes room for often hides a layout bug; say so.
- A timeout that doesn't bound what it claims, or that cuts off the normal case: rate by what users see when it fires.

### 4c. The upstream sibling

List every new Positron UI component, renderer, widget, editor contribution, or action that extends, wraps, copies, or sits next to an upstream one (a subclass, the same base class, registered in the same registry, or shown in the same view). For each, name the closest upstream sibling and compare these behaviors, citing the sibling's lines:

- **Read-only states:** does the sibling go read-only for a policy value, an admin-enforced value, a restricted workspace, or a read-only window? Does the new code?
- **Focus and selection:** active and inactive selection and focus styling, and which theme tokens it uses.
- **Keyboard:** are shortcuts registered keybindings (so they show in Keyboard Shortcuts) or handled ad hoc? Do tooltips and `aria-label`s show them? Is there a way to discover them?
- **Accessibility:** roles, labels, and announced state, compared with the sibling.
- **Errors:** what the sibling shows when an action fails, and whether the new code can offer an action that will fail.

A difference users will see is a finding unless the PR says it is intended. When the sibling also lacks something, say so, and still judge the new code by what users of this setting or view will hit.

### 4d. Settings and enforced values

For every new or changed setting, and every new reader or writer of one:

- **Enforced values.** Admins enforce settings through policy, and on Posit Workbench through `POSITRON_ENFORCED_SETTINGS`, which lands in the policy value. Every UI that writes the setting must be read-only while it is enforced, and every reader must use the effective value. Trace what happens when a user tries to change an enforced value through the new UI.
- **Scopes.** If the code reads `inspect()` values itself, check that it covers the scopes that apply (application, user, workspace, folder, language overrides).
- **Reusing an upstream setting** for a new purpose: compare with what upstream documents and does. Will values users already have now do something they didn't ask for?
- Keys, titles, and localize IDs follow `.claude/rules/configuration.md`. AI features gate on `ai.enabled`.

### 4e. Saved state and upgrades

When the change alters what gets saved (storage keys, caches, saved affiliations, settings, on-disk formats), including when it **stops** saving something or changes an answer another component saves: what did shipped releases already save, does the new code still read it, and does the change's main behavior happen for a user upgrading with that data? Date the old behavior with `git log -S'<key>' --reverse --format=%h $BASE -- <paths> | head -1` and `git tag --contains <commit>` (release tags look like `2026.11.1-4`; if that prints nothing, say you couldn't date it). Saved data from a shipped release that blocks the change's main behavior is at least `important (upgrade)`.

### 4f. Positron dimensions the diff touches

One line each in the coverage note, only for those the diff touches:

- **Upstream isolation:** a file with a Microsoft header at `BASE` (including vscode-python files under `extensions/positron-python`) needs every edit inside `// --- Start Positron ---` / `// --- End Positron ---` markers, with a reason and the replaced code commented. Unmarked edits, or logic that could live in a new file, are findings.
- **Where it runs:** `common/` imports no `browser/`, `node/`, or `electron-*/`; `browser/` uses no Node APIs. For the browser build and REH/Workbench: host-relative URLs, `localhost` vs `127.0.0.1`/`::1`, client-only paths, dynamic imports the server build doesn't bundle.
- **Platforms:** Windows paths (separators, drive case, spaces, forward slashes users type in settings), CRLF in parsed text, case-insensitive filesystems, shell differences.
- **Release build:** built-in extension `activationEvents`, strings in `package.nls.json`, files packaging drops or wrongly ships, new `.js` files and `.eslint-allowed-javascript-files`.
- **Contracts:** `positron.d.ts`, proposed APIs, and `positron/comms/*.json` schemas need regenerated code and a plan for Ark and the Python kernel.
- **Failing safe:** a check the change relies on that can be skipped (nothing to verify against, an input that doesn't parse, an error swallowed by a fallback). Does the code stop, or continue as if it passed?

### 4g. Size

Write one sentence on what the change does in user terms, and one line with production and test lines changed. Flag a mechanism that isn't load-bearing: an existing mechanism already does it, it guards against something impossible, or it exists only because of another design choice. Grep for other copies of a new helper's core operation; if copies exist, name them and say which can use the new helper. Same-behavior cuts that save more than about 20 production lines are `important (simplification)`; smaller ones are `minor`.

## Step 5: Merge and rank

1. **Fact-check each general-pass finding** at `TARGET`. It is often right about the bug and wrong about the context, especially about what upstream code does and about later revisions.
    - **Drop** only when the code contradicts a fact it states, or the PR description explicitly accepts that cost. Cite the line or the words in the coverage note.
    - **Correct** a finding whose framing is wrong but whose point holds. Keep the point, fix the facts.
    - **Don't drop** for "predates the change", "also elsewhere", or "unlikely". Rate it instead.
    - **Can't confirm or refute:** keep it as a `minor` question and say what you couldn't check.
    - Ignore remarks about what a later revision does.
2. **Apply Positron's guidance.** Correct findings that apply upstream guidance where Positron's differs (Step 3 table) or miss a nested rule.
3. **Merge duplicates** into one finding with the combined evidence.
4. **Rate everything.** Before rating a finding, write one sentence (for yourself) on what a user sees when it happens. Then apply the floors below.

**Floors.** These are at least `important`, however small the fix:

- A normal user action produces an error message, or the UI offers a control that can't work (a move, an edit, or a button whose write will be rejected).
- An admin-enforced or policy value is not honored by new UI or new code.
- The default experience on some platform differs from before when the PR says it doesn't.
- A setting or feature silently does nothing for a realistic group of users.
- A verification can be skipped without anyone noticing.
- Saved data from a shipped release blocks the change's main behavior.

**Other rating rules.**

- State the likelihood and impact of a rare case, and name the cheapest adequate response, including accepting it.
- Don't re-raise what the PR description lists as out of scope or an accepted cost, unless you have evidence it was misjudged. An announced behavior change isn't an accepted cost unless it says who is affected.
- A pre-existing problem the change now relies on is the change's finding, rated on its effect now.
- Scope findings (unrelated changes) are `minor (scope)` unless the unrelated change carries its own risk.
- A finding that depends on behavior outside the repo states the assumption and how to confirm it. If no code or doc you read supports the assumption, write it as a question and cap it at `minor`, unless a floor applies and the repo's own code shows the path exists.

## Step 6: Deliver the review

The review exists to find things to change. Strengths get one line in the Summary.

**Finding style.** Write for an engineer who hasn't loaded the subsystem. One problem per finding, in this order: what goes wrong, how it happens (a short flow when order matters), a concrete case (values, user actions, platform or build), why it matters, and the fix. Lead with what the user or caller sees, not implementation vocabulary. Important and critical findings may take a few sentences; minor ones stay short. Plain ASCII only.

Tag each **`priority (reason)`** and sort by priority. `critical`: must be addressed before this lands. `important`: should be fixed, doesn't block alone. `minor`: polish. Reasons are one word: `correctness`, `policy`, `upstream`, `platform`, `remote`, `upgrade`, `api`, `ux`, `accessibility`, `tests`, `convention`, `clarity`, `simplification`, `scope`, `preexisting` (never critical), or a better word.

```markdown
# Review: <PR #<n> - <title> | branch <name> | range <A>..<B> | local changes>

## Summary
<Up to 5 sentences: what the change does; BASE..TARGET; the general pass's level or that it was unavailable; blind or inline (and if inline, whether this session wrote the change); overall read with a one-line take on strengths; answers to questions the PR asks reviewers; coverage gaps.>

## Size
<behavior sentence; production/test lines; proportionate, or what could be cut>

## Findings
> To the agent acting on this review: triage these findings before changing code, following "Acting on this review" in the `positron-review` skill.

- **important (policy)** - `file:line`: <...>
- **minor (clarity)** - `file:line`: <...>

<!-- Coverage note: areas read; guidance used and skipped; Step 4 inventories with results; general-pass findings kept / merged / corrected / dropped (with reasons for drops); layer-only findings; open questions. -->
```

Write "No findings." if the list is empty.

Then:

1. **Save the review** under `reviews/` at the root of the checkout or worktree, as `reviews/{yyyy-mm-dd}-{hhmm}-pr-<n>.md`, `-range-<short A>-<short B>.md`, or `-local.md`. The repo's `.gitignore` ignores `/reviews/`, so reviews never get committed.
2. **Return a 2-4 line digest:** the overall read and the critical and important headlines, with the file path last.

**Posting to the PR** only on an explicit request in the conversation: draft each selected finding as an inline comment at its line on the PR head (a `suggestion` block only for drop-in fixes), in the author-facing voice with no priority tags or mention of this skill, show the drafts, and post after the user confirms.

## Acting on this review

When asked to act on a review, triage before changing code:

1. Group findings that come from one design choice and judge the choice once. If most findings come from an earlier round's fixes, say so and propose removing the choice behind them.
2. Give each finding or group one disposition, preferring the earliest that holds: **Reject** (wrong about the code; say why), **Remove the cause**, **Accept** (rare or low-impact; record it under "Accepted costs" in the PR description), **Fix**.
3. Judge cost across the whole round; several cheap fixes add up to a mechanism.
4. Reply with a table (finding, disposition, one-line reason). `important (scope)` findings and anything that changes user-visible behavior are the user's call: recommend, then ask.

## Fallback general pass

Only when Step 2 couldn't run `code-review`: correctness (claimed behavior, edge cases, error handling, async ordering, cancellation), disposal and leaks (`DisposableStore`, `MutableDisposable`; disposables from repeatedly called methods are returned, not registered on the class), type safety (casts, `any`, non-null assertions hiding a real case), and root `CLAUDE.md` conventions the linter doesn't enforce, cited.

## Maintaining this skill

After editing this file, re-test it blind on past PRs whose human reviewers found real problems, and on at least one PR never used for this skill. A PR only measures recall if none of its review comments shaped this file; once a PR's findings shape a version, it is a regression check only. Don't use those findings as examples or checklist wording here. List the PRs you used and the results in the description of the PR that changes this file.

To run a test blind:

- Review the commit the humans reviewed (a review comment's `original_commit_id`), not the merged head, which already has the fixes.
- Give the run the PR description as it read at review time (GraphQL `userContentEdits` on the PR holds each version), saved to a file.
- Bar the run, and any worker it starts, from `gh`, network access, commits after the target, other checkouts at a later revision, memory files, and earlier reviews.
- Run each PR at least twice; single runs vary a lot, so treat results as a direction, not a rate.
- Score the merged review against the human findings. Keep the general pass's own list too, so the same run also scores `/code-review` alone.

The test's coordinator starts the two agents itself, and its working directory must be a worktree at `TARGET`, because `/code-review` reads the coordinator's directory. Start the coordinating session in that worktree, or move it there before starting the general pass. The worktree needs no install or build. If the coordinator can't start agents, it runs inline, which is still blind because it has no history. Record which way each run went.

## Rules

1. **Review-only.** Never merge, push, commit, amend, check out, stash, or modify the code under review.
2. **Don't run builds, type checks, lints, or tests.** Judge by reading; report suspected failures as findings. Read-only `git`, `gh`, `scripts/file-origin.sh`, and `code-review` (without `--fix` or `--comment`) are fine.
3. **Never discard uncommitted work.**
4. **Nothing outward-facing without an explicit request:** no PR comments, reviews, labels, or approvals.
5. **Keep the reviewers blind.** No brief carries the conversation, a summary of it, earlier findings, or a hypothesis, and the coordinator relays the general pass's findings verbatim.
