#!/usr/bin/env python3
#
# Open a PR against posit-dev/positron that bumps the Ark submodule
# (extensions/positron-r/ark) to a target commit.
#
# Fully API-driven via `gh`: no local clone or working tree is read or mutated,
# so it is safe to run from anywhere and never force-pushes.

# Turns annotations into unevaluated strings, so `build_bump`'s reference to
# `Resolution` below (defined later in the file) doesn't raise `NameError` on
# import.
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Callable, Optional

from bump_notes import build_notes

USAGE = """\
Usage: bump_ark.py <pr-number | main> [@:tag ...] [--confirm] [--dry-run]

Opens a PR against posit-dev/positron bumping the Ark submodule.
  <pr-number>  bump to the head commit of that Ark PR (its merge commit once merged)
  main         bump to latest posit-dev/ark@main
  @:tag        Positron e2e test tags (@:ark is always included)
  --confirm    advance the open main bump even if a colleague owns it
  --dry-run    print the PR body to stdout; no branch, ref, or PR is touched"""

ARK_REPO = "posit-dev/ark"
ARK_BASE_BRANCH = "main"
POSITRON_REPO = "posit-dev/positron"
SUBMODULE_PATH = "extensions/positron-r/ark"
BASE_BRANCH = "main"

# Fallback cap for `walk_first_parents` when no tighter bound is supplied. In
# practice `first_parent_commits` always passes the compare's `total_commits`,
# which bounds the walk exactly, so this only backstops direct callers (the unit
# tests) against an unterminated walk.
MAX_WALK = 1000

# `gh` honors these force-color vars even when its output is a pipe, which injects
# ANSI codes into the JSON we capture and breaks parsing. Drop them so `gh` falls
# back to its normal "no color when not a terminal" behavior.
GH_ENV = {
    k: v for k, v in os.environ.items() if k not in ("CLICOLOR_FORCE", "FORCE_COLOR")
}


# --- entrypoint ---------------------------------------------------------


def main():
    try:
        sys.exit(run(sys.argv[1:]))
    except BumpError as error:
        eprint(error.message)
        sys.exit(error.code)


def run(argv: list[str]) -> int:
    target_arg, tag_args, confirm, dry_run = parse_args(argv)
    check_gh()

    bump = build_bump(target_arg, tag_args)
    if bump is None:
        return 0
    resolution, body = bump

    if dry_run:
        print(body)
        return 0

    # Only main bumps are author-guarded; a PR bump is keyed on the Ark PR, so
    # collaborators converge on the same PR rather than clobber each other.
    enforce_author = not resolution.is_pr_bump

    open_or_update_tracked_bump(
        resolution.sha,
        resolution.title,
        resolution.branch,
        body,
        enforce_author,
        confirm,
    )
    return 0


# Resolve the target and assemble its PR body, using only read-only `gh` calls, no
# branch, ref, or PR is created or modified. Returns None when the submodule is
# already at the target, the one outcome that has no body to hand back.
def build_bump(
    target_arg: str, tag_args: list[str]
) -> Optional[tuple[Resolution, str]]:
    resolution = resolve_target(target_arg)

    current_sha = gh_json(
        "api", f"repos/{POSITRON_REPO}/contents/{SUBMODULE_PATH}?ref={BASE_BRANCH}"
    )["sha"]
    if current_sha == resolution.sha:
        eprint(
            f"Submodule is already at {resolution.sha} on {POSITRON_REPO}@{BASE_BRANCH}. Nothing to bump."
        )
        return None

    compare = check_ancestry(current_sha, resolution.sha)
    eprint(f"Bumping {SUBMODULE_PATH}: {current_sha} -> {resolution.sha}")

    walk = first_parent_commits(
        compare.merge_base, resolution.sha, compare.commit_map, compare.total_commits
    )

    associations = pr_associations(walk, resolution.target_pr)
    chain, chain_messages = stack_chain(resolution.target_pr, associations.unmerged)
    for message in chain_messages:
        eprint(message)
    commit_lines = walk_lines(group_walk(walk, associations, chain))

    notes = collect_release_notes(associations, chain)
    closes = "\n".join(f"Closes #{n}" for n in notes["closes"])
    body = build_body(closes, tag_line(tag_args), notes["notes"], commit_lines)

    return resolution, body


# Pull `--confirm`/`--dry-run` out from anywhere in the args; what's left is the
# target (first positional) and the e2e tags. Returns (target, tags, confirm, dry_run).
def parse_args(argv: list[str]) -> tuple[str, list[str], bool, bool]:
    confirm = False
    dry_run = False
    rest = []
    for arg in argv:
        if arg == "--confirm":
            confirm = True
        elif arg == "--dry-run":
            dry_run = True
        else:
            rest.append(arg)
    if not rest:
        eprint(USAGE)
        sys.exit(1)
    return rest[0], rest[1:], confirm, dry_run


def check_gh():
    if shutil.which("gh") is None:
        raise BumpError("Error: gh CLI not found.")
    if (
        subprocess.run(
            ["gh", "auth", "status"], capture_output=True, env=GH_ENV
        ).returncode
        != 0
    ):
        raise BumpError("Error: gh is not authenticated (run 'gh auth login').")


# --- target resolution ------------------------------------------------------


@dataclass
class UnmergedPr:
    number: int
    title: str
    body: str
    base_ref: str
    head_ref: str


@dataclass
class Resolution:
    sha: str
    title: str
    branch: str
    # Set only on an unmerged PR bump. The target's own commits, and those of the
    # PRs it is stacked on, belong to no merged PR, so the walk's merged-only
    # filter can't see them. None on a merged PR bump and a main bump, whose
    # notes ride the walk.
    target_pr: Optional[UnmergedPr]
    is_pr_bump: bool


def unmerged_pr(pr: dict) -> UnmergedPr:
    base = pr.get("base") or {}
    head = pr.get("head") or {}
    return UnmergedPr(
        number=pr["number"],
        title=pr.get("title") or "",
        body=pr.get("body") or "",
        base_ref=base.get("ref") or "",
        head_ref=head.get("ref") or "",
    )


# Each logical bump gets a single fixed branch it advances in place. A PR bump
# uses `bump-ark/pr-<N>` and tracks one Ark PR across its whole life: while the
# PR is open it targets the PR head, once merged it targets the merge commit. A
# main bump uses `bump-ark/main` and tracks the latest Ark main.
def resolve_target(arg: str) -> Resolution:
    if arg == "main":
        sha = gh_json("api", f"repos/{ARK_REPO}/commits/{ARK_BASE_BRANCH}")["sha"]
        return Resolution(sha, "Bump Ark to latest main", "bump-ark/main", None, False)

    if not arg.isdigit():
        raise BumpError(
            f"Error: first argument must be a PR number or 'main' (got '{arg}')."
        )

    pr = gh_json("api", f"repos/{ARK_REPO}/pulls/{arg}")
    resolution, messages = pr_resolution(arg, pr)

    for message in messages:
        eprint(message)

    return resolution


# Pure decision for a PR bump: map the fetched PR JSON to a Resolution plus the
# stderr messages the caller should emit. Fatal cases raise BumpError.
def pr_resolution(pr_number: str, pr: dict) -> tuple[Resolution, list[str]]:
    messages: list[str] = []
    title = f"Bump Ark to posit-dev/ark#{pr_number}"
    branch = f"bump-ark/pr-{pr_number}"

    if pr.get("merged_at"):
        # Finalize: point the bump at the merge commit on Ark main. This works for
        # squash, merge-commit, and rebase merges alike, since GitHub sets
        # `merge_commit_sha` for all three and each lands reachable from main via
        # first parents.
        merge_commit = pr.get("merge_commit_sha")
        if not merge_commit:
            raise BumpError(
                f"Error: PR #{pr_number} is merged but has no merge commit sha; can't finalize the bump."
            )
        messages.append(
            f"PR #{pr_number} is merged. Finalizing the bump to its merge commit {merge_commit}."
        )
        return Resolution(merge_commit, title, branch, None, True), messages

    if pr.get("state") == "closed":
        messages.append(
            f"Warning: PR #{pr_number} is closed (not merged). Bumping to its last head commit anyway."
        )

    head = pr.get("head") or {}
    head_repo = (head.get("repo") or {}).get("full_name") or ""
    if head_repo != ARK_REPO:
        where = head_repo or "deleted fork"
        raise BumpError(
            f"Error: PR #{pr_number} head lives in '{where}', not '{ARK_REPO}'.\n"
            "       The submodule can't resolve to a fork commit, so refusing to bump."
        )

    return Resolution(head["sha"], title, branch, unmerged_pr(pr), True), messages


# --- ancestry ---------------------------------------------------------------


@dataclass
class Ancestry:
    merge_base: str
    messages: list[str] = field(default_factory=list)
    # None: continue. 0: nothing to do. 1: refuse. Set when the caller must exit.
    exit_code: Optional[int] = None


@dataclass
class CompareResult:
    # The commit the first-parent walk stops at (the current pointer for a clean
    # fast-forward, the fork point for diverged history).
    merge_base: str
    # Commits in the range, which is the tight upper bound on the first-parent
    # walk length (the first-parent chain is a subset of all commits).
    total_commits: int
    # sha -> (subject, first-parent sha) for every commit `compare` returned
    # (capped at 250). The walk reads these instead of refetching each commit.
    commit_map: dict[str, tuple[str, Optional[str]]]


# Diagnose how the target relates to the current pointer, so a backward or diverged
# bump is caught upfront rather than surfacing as a runaway first-parent walk.
# `status` is relative to the current pointer. Hands back the compare payload the
# first-parent walk then reads (merge base, commit count, and the per-commit
# summaries) so the walk needs no further API calls in the common case.
def check_ancestry(current: str, target: str) -> CompareResult:
    info = gh_json("api", f"repos/{ARK_REPO}/compare/{current}...{target}")
    result = classify_ancestry(
        info["status"],
        info["ahead_by"],
        info["behind_by"],
        info["merge_base_commit"]["sha"],
    )

    for message in result.messages:
        eprint(message)
    if result.exit_code is not None:
        sys.exit(result.exit_code)

    commit_map = {c["sha"]: commit_summary(c) for c in info.get("commits") or []}
    return CompareResult(result.merge_base, info.get("total_commits", 0), commit_map)


# Pure classification of a `compare` result.
def classify_ancestry(
    status: str, ahead: int, behind: int, merge_base: str
) -> Ancestry:
    if status == "ahead":
        return Ancestry(
            merge_base, [f"Target is {ahead} commit(s) ahead of the current pointer."]
        )
    if status == "identical":
        return Ancestry(
            merge_base,
            ["Submodule is already at the target. Nothing to bump."],
            exit_code=0,
        )
    if status == "behind":
        return Ancestry(
            merge_base,
            [
                "Error: the current submodule pointer already contains the target",
                f"       (target is {behind} commit(s) behind it). Refusing to bump backward.",
            ],
            exit_code=1,
        )
    if status == "diverged":
        return Ancestry(
            merge_base,
            [
                "Warning: the target is not based on the current Ark main pointer",
                f"         ({ahead} ahead, {behind} behind). The commit list will include",
                "         divergent commits and the resulting PR may be stale.",
            ],
        )

    # Unreachable: GitHub's compare API documents exactly the four statuses above.
    return Ancestry(
        merge_base,
        [f"Error: unexpected compare status '{status}'. Refusing to bump."],
        exit_code=1,
    )


# Reduce a commit JSON object to the (subject, first-parent sha) pair the walk
# needs. Works for both the single-commit and the `compare` endpoints, which
# return commits in the same shape.
def commit_summary(commit: dict) -> tuple[str, Optional[str]]:
    subject = commit["commit"]["message"].split("\n", 1)[0]
    parents = commit.get("parents") or []
    parent = parents[0]["sha"] if parents else None
    return subject, parent


# --- first-parent walk ------------------------------------------------------


# List the commits in the range `from_sha..to_sha` (newest first, walking parents
# back from the `to_sha` end), reading the commit summaries `compare` already
# returned and only fetching a commit one-off when it
# falls outside that payload (a bump spanning more than the 250 commits `compare`
# caps at). `total_commits` bounds the walk exactly: the first-parent chain can't
# be longer than the range's commit count, so a walk that overruns it has left the
# first-parent line and is caught after a handful of steps rather than fetching up
# to MAX_WALK commits.
def first_parent_commits(
    from_sha: str,
    to_sha: str,
    commit_map: dict[str, tuple[str, Optional[str]]],
    total_commits: int,
) -> list[tuple[str, str]]:
    def get_commit(sha: str) -> tuple[str, Optional[str]]:
        cached = commit_map.get(sha)
        return cached if cached is not None else gh_get_commit(sha)

    return walk_first_parents(from_sha, to_sha, get_commit, max_walk=total_commits)


def gh_get_commit(sha: str) -> tuple[str, Optional[str]]:
    return commit_summary(gh_json("api", f"repos/{ARK_REPO}/commits/{sha}"))


# List the commits in git's range `from_sha..to_sha`, newest first. The parameter
# names follow that range syntax: `from_sha` is the older, excluded end (the current
# pointer) and `to_sha` is the newer, included end (the target). The walk runs
# backward, from `to_sha` down to `from_sha`, because a git commit records only its
# parents, not its children, so newest-first is the only direction we can follow.
# `get_commit(sha)` yields (subject, first_parent_sha_or_None). Same result as
# `git log --first-parent <from>..<to>` without a local clone, as long as `from_sha`
# sits on that chain. Bails if the walk hits a root commit or `max_walk` without
# reaching `from_sha`, since the commit list would otherwise be wrong (a partial
# history, or the whole repo up to the cap).
def walk_first_parents(
    from_sha: str,
    to_sha: str,
    get_commit: Callable[[str], tuple[str, Optional[str]]],
    max_walk: int = MAX_WALK,
) -> list[tuple[str, str]]:
    walk: list[tuple[str, str]] = []
    sha = to_sha
    count = 0

    while sha != from_sha and count < max_walk:
        subject, parent = get_commit(sha)
        walk.append((sha, subject))
        count += 1
        if not parent:
            break
        sha = parent

    if sha != from_sha:
        raise BumpError(
            f"Error: walked {count} first-parent commit(s) back from the target without\n"
            f"       reaching the current pointer {from_sha}.\n"
            "       It is reachable from the target only through a merge commit's second\n"
            "       parent, so a first-parent commit list can't span the gap. This is\n"
            "       unexpected for Ark's squash-merge history."
        )
    return walk


# --- PR associations and stacking -------------------------------------------


@dataclass
class PrAssociations:
    # PR number -> body, for the merged PRs behind the walked commits.
    merged_bodies: dict[int, str]
    # PR number -> PR, for the unmerged PRs whose branch contains a walked commit.
    unmerged: dict[int, UnmergedPr]
    # Walked commit sha -> the unmerged PRs GitHub associates with it.
    commit_prs: dict[str, list[int]]


@dataclass
class GroupEntry:
    # None for a commit rendered on its own, otherwise the PR whose commits this
    # entry collapses.
    pr_number: Optional[int]
    # The entry's own commit, or the newest of the group.
    sha: str
    subject: str
    count: int
    title: str = ""


# Fetch, for every walked commit, every PR whose branch contains it. Splits them
# into merged PR bodies and unmerged PRs, plus the per-commit association lists
# `group_walk` needs to attribute a commit to the right PR in a stack.
#
# `target_pr` seeds `unmerged` before the walk, so an unmerged bump target that
# GitHub's association list happens to omit still roots its stack.
def pr_associations(
    walk: list[tuple[str, str]], target_pr: Optional[UnmergedPr]
) -> PrAssociations:
    merged_bodies: dict[int, str] = {}
    unmerged: dict[int, UnmergedPr] = {}
    commit_prs: dict[str, list[int]] = {}

    if target_pr is not None:
        unmerged[target_pr.number] = target_pr

    for sha, _ in walk:
        for pr in gh_json("api", f"repos/{ARK_REPO}/commits/{sha}/pulls") or []:
            number = pr["number"]
            if pr.get("merged_at"):
                merged_bodies.setdefault(number, pr.get("body") or "")
            else:
                unmerged.setdefault(number, unmerged_pr(pr))
                commit_prs.setdefault(sha, []).append(number)

    return PrAssociations(merged_bodies, unmerged, commit_prs)


# The target's stack, top first, ending at the PR based on Ark main, plus the
# stderr messages the caller should emit. Each step matches a PR's base branch
# against the head branch of another unmerged PR, so it recognizes a stack however
# it was built. `target_pr` is None on a merged PR bump and a main bump, neither of
# which has a stack, so they get back `([], [])`.
#
# The chain stops at a base branch no unmerged PR heads, which is silent because
# that also covers the ordinary case of a branch pushed without a PR. The commits
# below such a branch stay listed individually.
def stack_chain(
    target_pr: Optional[UnmergedPr], unmerged: dict[int, UnmergedPr]
) -> tuple[list[int], list[str]]:
    if target_pr is None:
        return [], []

    chain = [target_pr.number]
    current = target_pr

    while current.base_ref != ARK_BASE_BRANCH:
        next_pr = next(
            (
                pr
                for pr in unmerged.values()
                if pr.head_ref == current.base_ref and pr.number not in chain
            ),
            None,
        )
        if next_pr is None:
            break
        chain.append(next_pr.number)
        current = next_pr

    messages = []
    if len(chain) > 1:
        stacked_on = ", ".join(f"#{number}" for number in chain[1:])
        messages.append(
            f"PR #{chain[0]} is stacked on {stacked_on}. Collapsing each PR's commits into one line."
        )

    return chain, messages


# Group the walk into one entry per `chain` PR, collapsing its commits, and one
# entry per commit belonging to no `chain` PR. A commit's owner is the `chain` PR
# closest to Ark main among those associated with it, because every PR's branch
# contains the commits of the PRs below it, so a bottom-of-stack commit is listed
# under the whole stack above it too. Unmerged PRs outside `chain` are ignored,
# which keeps a mid-stack target from pulling in the PRs stacked above it.
def group_walk(
    walk: list[tuple[str, str]], associations: PrAssociations, chain: list[int]
) -> list[GroupEntry]:
    chain_index = {number: index for index, number in enumerate(chain)}
    entries: list[GroupEntry] = []
    entry_by_pr: dict[int, GroupEntry] = {}

    for sha, subject in walk:
        candidates = [
            n for n in associations.commit_prs.get(sha, []) if n in chain_index
        ]
        owner = max(candidates, key=lambda n: chain_index[n]) if candidates else None

        if owner is None:
            entries.append(GroupEntry(None, sha, subject, 1))
            continue

        entry = entry_by_pr.get(owner)
        if entry is None:
            entry = GroupEntry(
                owner, sha, subject, 1, associations.unmerged[owner].title
            )
            entry_by_pr[owner] = entry
            entries.append(entry)
        else:
            entry.count += 1

    return entries


# --- release notes ----------------------------------------------------------


# Gather the release notes of every merged PR behind the walked commits and of
# every PR in the target's stack, and hand their bodies to the vendored
# release-notes parser. `chain` order (top first) matches the newest-first
# ordering the rest of the body uses.
def collect_release_notes(associations: PrAssociations, chain: list[int]) -> dict:
    bodies = dict(associations.merged_bodies)
    for number in chain:
        bodies.setdefault(number, associations.unmerged[number].body)

    return build_notes([{"number": n, "body": b} for n, b in bodies.items()])


# --- body assembly ----------------------------------------------------------


# The space-separated tag line: `@:ark` first, then the caller's tags, each
# normalized to an `@:` prefix, deduped while preserving order.
def tag_line(tags: list[str]) -> str:
    result = ["@:ark"]
    for raw in tags:
        normalized = raw if raw.startswith("@:") else f"@:{raw}"
        if normalized not in result:
            result.append(normalized)
    return " ".join(result)


# Escape brackets in link text, so a stray `[`/`]` (e.g. `[skip ci]`) can't break
# the surrounding markdown link syntax.
def escape_brackets(text: str) -> str:
    return text.replace("[", r"\[").replace("]", r"\]")


# Render a walked commit as a markdown link to the Ark commit. The link does
# double duty: it points at the Ark side, and it stops GitHub from autolinking the
# `(#NNNN)` Ark PR reference in the subject to a Positron issue of the same number,
# since autolinking doesn't fire inside link text.
def commit_line(sha: str, subject: str) -> str:
    return f"- [{escape_brackets(subject)}](https://github.com/{ARK_REPO}/commit/{sha})"


# Render an unmerged PR's collapsed group as a markdown link to the PR, the
# squash-merge-style line it will get once the PR merges. Same link-text
# placement of `(#N)` as `commit_line`, for the same autolinking reason.
def pr_line(number: int, title: str, count: int) -> str:
    text = escape_brackets(f"{title} (#{number})")
    unit = "commit" if count == 1 else "commits"
    return f"- [{text}](https://github.com/{ARK_REPO}/pull/{number}) ({count} unmerged {unit})"


# Render the `### Commits` block: a `pr_line` for an entry with a `pr_number`, a
# `commit_line` otherwise.
def walk_lines(entries: list[GroupEntry]) -> str:
    lines = []
    for entry in entries:
        if entry.pr_number is None:
            lines.append(commit_line(entry.sha, entry.subject))
        else:
            lines.append(pr_line(entry.pr_number, entry.title, entry.count))
    return "\n".join(lines)


# Assemble the PR body. `Closes` lines go first (GitHub reads closing keywords
# anywhere, and keeping them above the release-notes headers stops the collector
# from parsing them as items). Omitted entirely when there are no issues.
def build_body(closes: str, tags: str, notes: str, commit_lines: str) -> str:
    parts = []
    if closes:
        parts.append(closes)
    parts += [tags, notes, f"### Commits\n\n{commit_lines}"]
    return "\n\n".join(parts)


# --- branch and PR mutation -------------------------------------------------


# Make this bump's branch and its PR point at `target_sha`, no matter their
# current state (branch missing, behind, or already there, and PR open or not).
# When the branch needs to move we push a fast-forward commit that retriggers
# tests on CI. The resulting PR URL is printed to stdout as the machine-readable
# result whereas progress streams to stderr.
#
# `enforce_author` is True only for main bumps. When it is set and the open PR
# belongs to someone else, refuse unless `confirm` is given, and exit with code 3.
def open_or_update_tracked_bump(
    target_sha: str,
    title: str,
    branch: str,
    body: str,
    enforce_author: bool,
    confirm: bool,
):
    prs = gh_json(
        "pr",
        "list",
        "--repo",
        POSITRON_REPO,
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number,url,author",
    )
    pr = prs[0] if prs else None

    # Author-gate before touching the branch, so a refusal never stacks a commit
    # onto a colleague's PR.
    me = (
        gh_json("api", "user")["login"]
        if (enforce_author and pr and not confirm)
        else None
    )
    pr_author = pr["author"]["login"] if pr else None
    if pr is not None and blocked_by_pr_owner(
        enforce_author, True, pr_author, me, confirm
    ):
        raise BumpError(
            f"Refusing: the '{title}' PR belongs to @{pr_author} ({pr['url']}).\n"
            f"         Ask the user to confirm advancing @{pr_author}'s PR before re-running with --confirm.",
            code=3,
        )

    tip = branch_head_sha(branch)
    if tip is None:
        ensure_branch(target_sha, title, branch)
    elif branch_submodule_sha(branch) != target_sha:
        eprint(f"Advancing {branch} to {target_sha}")
        stack_submodule_commit(branch, target_sha, title, tip)

    if pr:
        gh(
            "api",
            "-X",
            "PATCH",
            f"repos/{POSITRON_REPO}/pulls/{pr['number']}",
            "--input",
            "-",
            input_obj={"title": title, "body": body},
        )
        eprint(f"Updated {pr['url']}")
        print(pr["url"])
        return

    url = gh_json(
        "api",
        "-X",
        "POST",
        f"repos/{POSITRON_REPO}/pulls",
        "--input",
        "-",
        input_obj={"title": title, "head": branch, "base": BASE_BRANCH, "body": body},
    )["html_url"]
    eprint(f"Opened {url}")
    print(url)


# True when we must refuse: a main bump (`enforce_author`) with an open PR that
# belongs to someone else and no `--confirm`. `me` may be None when the cheap
# conditions already rule refusal out.
def blocked_by_pr_owner(
    enforce_author: bool,
    has_pr: bool,
    pr_author: Optional[str],
    me: Optional[str],
    confirm: bool,
) -> bool:
    if not (enforce_author and has_pr and not confirm):
        return False
    return pr_author != me


def branch_head_sha(branch: str) -> Optional[str]:
    """Branch tip commit sha, or None if the branch doesn't exist."""
    proc = gh("api", f"repos/{POSITRON_REPO}/git/ref/heads/{branch}", allow_fail=True)
    if proc.returncode != 0:
        return None
    return json.loads(proc.stdout)["object"]["sha"]


# Create the bump branch off main if it doesn't already exist. Never force-pushes:
# an existing branch is left untouched.
def ensure_branch(target_sha: str, title: str, branch: str):
    if (
        gh(
            "api", f"repos/{POSITRON_REPO}/git/ref/heads/{branch}", allow_fail=True
        ).returncode
        == 0
    ):
        return

    base_commit = gh_json("api", f"repos/{POSITRON_REPO}/git/ref/heads/{BASE_BRANCH}")[
        "object"
    ]["sha"]
    new_commit = make_bump_commit(target_sha, title, base_commit)
    gh(
        "api",
        "-X",
        "POST",
        f"repos/{POSITRON_REPO}/git/refs",
        "--input",
        "-",
        input_obj={"ref": f"refs/heads/{branch}", "sha": new_commit},
    )


# Create a commit that sets the submodule gitlink (mode 160000, type commit) to
# `target_sha`, parented on `parent`. The tree is `parent`'s own tree with only the
# gitlink swapped, so the commit is a pure one-file change. Returns the new commit
# sha.
#
# Why parent's tree and not current main's tree: a PR's diff is measured from its
# merge base, the commit the branch was cut from, which stacking never moves. If we
# rebuilt the tree from current main, every file main touched since the fork would
# land in the bump PR's diff, and a later main edit to one of them would conflict on
# merge. A pure gitlink delta keeps the PR touching only the submodule, however far
# main has drifted.
def make_bump_commit(target_sha: str, title: str, parent: str) -> str:
    base_tree = gh_json("api", f"repos/{POSITRON_REPO}/git/commits/{parent}")["tree"][
        "sha"
    ]
    new_tree = gh_json(
        "api",
        "-X",
        "POST",
        f"repos/{POSITRON_REPO}/git/trees",
        "--input",
        "-",
        input_obj={
            "base_tree": base_tree,
            "tree": [
                {
                    "path": SUBMODULE_PATH,
                    "mode": "160000",
                    "type": "commit",
                    "sha": target_sha,
                }
            ],
        },
    )["sha"]
    return gh_json(
        "api",
        "-X",
        "POST",
        f"repos/{POSITRON_REPO}/git/commits",
        "--input",
        "-",
        input_obj={"message": title, "tree": new_tree, "parents": [parent]},
    )["sha"]


def branch_submodule_sha(branch: str) -> Optional[str]:
    """Submodule gitlink sha recorded on the given branch, or None if unavailable."""
    proc = gh(
        "api",
        f"repos/{POSITRON_REPO}/contents/{SUBMODULE_PATH}?ref={branch}",
        allow_fail=True,
    )
    if proc.returncode != 0:
        return None
    return json.loads(proc.stdout)["sha"]


# Advance an existing branch to a new commit that sets the submodule to
# `target_sha`, stacked on the current tip so the ref move is a fast-forward. The
# ref PATCH omits `force`, so a non-fast-forward (someone advanced the branch since
# `tip` was read) is rejected rather than clobbering their work.
def stack_submodule_commit(branch: str, target_sha: str, title: str, tip: str):
    new_commit = make_bump_commit(target_sha, title, tip)
    gh(
        "api",
        "-X",
        "PATCH",
        f"repos/{POSITRON_REPO}/git/refs/heads/{branch}",
        "--input",
        "-",
        input_obj={"sha": new_commit},
    )


# --- gh transport (shared by everything above) -------------------------


class BumpError(Exception):
    """A fatal condition whose `message` is printed verbatim to stderr, exiting
    with `code`. The message carries its own prefix ("Error: ", "Refusing: ")."""

    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.message = message
        self.code = code


def eprint(*args):
    print(*args, file=sys.stderr)


def gh(
    *args: str, input_obj=None, allow_fail: bool = False
) -> subprocess.CompletedProcess:
    """Run `gh <args>`, returning the completed process. `input_obj` is JSON-encoded
    onto stdin (pair it with `--input -`). A nonzero exit raises BumpError with gh's
    stderr, unless `allow_fail` is set (used to probe for a missing branch)."""
    input_str = json.dumps(input_obj) if input_obj is not None else None
    proc = subprocess.run(
        ["gh", *args],
        input=input_str,
        capture_output=True,
        encoding="utf-8",
        env=GH_ENV,
    )
    if proc.returncode != 0 and not allow_fail:
        raise BumpError(f"Error: `gh {' '.join(args)}` failed:\n{proc.stderr.rstrip()}")
    return proc


def gh_json(*args: str, input_obj=None):
    """`gh` call whose stdout is parsed as JSON. Empty output yields None."""
    out = gh(*args, input_obj=input_obj).stdout
    return json.loads(out) if out.strip() else None


if __name__ == "__main__":
    main()
