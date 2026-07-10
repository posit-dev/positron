---
name: bump-ark
description: Open or advance a Positron PR that bumps the Ark submodule to a given Ark PR (its head while open, its merge commit once merged) or to latest Ark main, with Positron e2e test tags. Use when the user runs /bump-ark with a PR number or "main" and optional @:tags.
---

# bump-ark

Opens a PR against `posit-dev/positron` that bumps the Ark submodule
(`extensions/positron-r/ark`) to a target commit. Everything goes through the
GitHub API via `gh`, so no local clone or working tree is read or touched, and
it never force-pushes.

## Usage

`/bump-ark <pr-number | main> [@:tag ...] [--confirm] [--dry-run]`

- `<pr-number>` tracks one Ark PR across its whole life on a single branch
  `bump-ark/pr-<N>`. While the PR is open the bump points at its head commit, so
  you can run Positron e2e against the dev branch. Once the Ark PR is merged,
  re-running `/bump-ark <N>` finalizes the same Positron PR to the merge commit
  on Ark main, turning the testing PR into the mergeable bump. Title:
  `Bump Ark to posit-dev/ark#<N>`.
- `main` bumps to the latest `posit-dev/ark@main` on a single branch
  `bump-ark/main`, advancing it in place on re-run. Title: `Bump Ark to latest main`.
- `@:tag` arguments are Positron e2e test tags. `@:ark` is always included; the
  supplied tags are added and deduped.
- `--confirm` advances the open `main` bump even when a colleague owns it (see
  below). Never pass it proactively.
- `--dry-run` prints the assembled PR body to stdout and exits, touching no
  branch, ref, or PR. Only read-only `gh` calls run. Use it to preview the
  `Closes`/tags/release-notes/commits body for a target before deciding to open
  or update anything, e.g. if the user wants to see it first.

The merge-commit finalize works for squash, merge-commit, and rebase merges
alike, since GitHub records `merge_commit_sha` for all three.

When the bumped PRs close Positron issues, the body opens with `Closes #<N>`
lines. Then the tag line, a `### Release Notes` section aggregated from the
bumped Ark PRs, and a `### Commits` first-parent list of the Ark commits between
the current submodule pointer and the target.

Release notes are scraped from each bumped Ark PR's `#### New Features` /
`#### Bug Fixes` bullets. `parse_description.py` is a vendored copy of
`posit-dev/positron-release-notes`'s parser, so extraction matches the
release-notes collector; `bump_notes.py` is the skill-local glue on top of it
(section rendering, `Closes` collection).

## How to run

Run the bundled script, forwarding the arguments verbatim. It needs `python3`
and an authenticated `gh`:

```bash
python3 .claude/skills/bump-ark/bump_ark.py <args>
```

Re-running is always safe. Both bump kinds track one fixed branch and advance it
by stacking a fast-forward commit onto its current tip (so the ref only ever
moves forward, never a force-push), then refresh the title and description from
scratch (commit list, release notes, `Closes` lines).

A PR bump has no author check: its content is fully determined by the Ark PR, so
collaborators converge on the same PR rather than clobber each other. A main bump
is author-guarded: you can freely advance your own open `Bump Ark to latest main`
PR, but if the open one belongs to a colleague the script refuses (it never
touches their branch) and exits 3.

When the script exits reporting that the main bump belongs to someone else,
**do not re-run with `--confirm` on your own initiative.** Relay who owns it and
its URL, and ask the user to confirm, for example: "The 'Bump Ark to latest main'
PR belongs to @foo (<url>). Advance it anyway?" Only if they explicitly confirm,
re-run the same command with `--confirm` appended.

The script prints the Positron PR URL to stdout (progress goes to stderr).
Relay that URL. If it reports that the submodule is already at the target,
relay that as-is instead.

With `--dry-run`, stdout is the PR body instead of a URL, and nothing is
created or modified: not the tracked branch, not its ref, not the PR. Use it
only when asked to preview a bump; the default `/bump-ark <args>` invocation
should not pass it.
