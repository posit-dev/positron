#!/usr/bin/env python3
#
# Unit tests for the pure decision logic in bump_ark.py. Run offline, no `gh`:
#
#   python3 -m unittest test_bump_ark
#
# The `gh`-driven orchestration (branch/ref/PR mutation) is not covered here; it
# is side-effecting against GitHub and not unit-testable without a sandbox repo.

import contextlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bump_ark import (  # noqa: E402
    ARK_REPO,
    BumpError,
    GroupEntry,
    PrAssociations,
    UnmergedPr,
    blocked_by_pr_owner,
    build_body,
    classify_ancestry,
    commit_line,
    commit_summary,
    first_parent_commits,
    group_walk,
    parse_args,
    pr_line,
    pr_resolution,
    stack_chain,
    tag_line,
    walk_first_parents,
)


class DecidePrResolutionTest(unittest.TestCase):
    def open_pr(self, **overrides):
        pr = {
            "number": 42,
            "title": "Some PR title",
            "body": "some body",
            "base": {"ref": "main"},
            "head": {"sha": "headsha", "repo": {"full_name": ARK_REPO}},
            "state": "open",
            "merged_at": None,
            "merge_commit_sha": None,
        }
        pr.update(overrides)
        return pr

    def test_open_pr_targets_head_and_sets_target_pr(self):
        resolution, messages = pr_resolution("42", self.open_pr())
        self.assertEqual(resolution.sha, "headsha")
        self.assertEqual(resolution.title, "Bump Ark to posit-dev/ark#42")
        self.assertEqual(resolution.branch, "bump-ark/pr-42")
        self.assertEqual(
            resolution.target_pr,
            UnmergedPr(42, "Some PR title", "some body", "main", ""),
        )
        self.assertTrue(resolution.is_pr_bump)
        self.assertEqual(messages, [])

    def test_merged_pr_targets_merge_commit_and_clears_target_pr(self):
        pr = self.open_pr(
            merged_at="2026-01-01T00:00:00Z",
            merge_commit_sha="mergesha",
            state="closed",
        )
        resolution, messages = pr_resolution("42", pr)
        self.assertEqual(resolution.sha, "mergesha")
        self.assertIsNone(resolution.target_pr)
        self.assertTrue(resolution.is_pr_bump)
        self.assertEqual(
            messages,
            ["PR #42 is merged. Finalizing the bump to its merge commit mergesha."],
        )

    def test_merged_pr_ignores_closed_and_fork_warnings(self):
        # A merged PR is always closed and its fork may be gone; those warnings
        # belong to the open path only, so finalize stays quiet about them.
        pr = self.open_pr(
            merged_at="2026-01-01T00:00:00Z",
            merge_commit_sha="mergesha",
            state="closed",
            head={"sha": "headsha", "repo": None},
        )
        _, messages = pr_resolution("42", pr)
        self.assertEqual(len(messages), 1)
        self.assertIn("Finalizing", messages[0])

    def test_merged_pr_without_merge_commit_is_fatal(self):
        pr = self.open_pr(merged_at="2026-01-01T00:00:00Z", merge_commit_sha=None)
        with self.assertRaises(BumpError) as ctx:
            pr_resolution("42", pr)
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("no merge commit sha", ctx.exception.message)

    def test_closed_unmerged_pr_warns_but_targets_head(self):
        resolution, messages = pr_resolution("42", self.open_pr(state="closed"))
        self.assertEqual(resolution.sha, "headsha")
        self.assertEqual(resolution.target_pr.number, 42)
        self.assertEqual(len(messages), 1)
        self.assertIn("is closed (not merged)", messages[0])

    def test_fork_head_is_fatal(self):
        pr = self.open_pr(head={"sha": "headsha", "repo": {"full_name": "someone/ark"}})
        with self.assertRaises(BumpError) as ctx:
            pr_resolution("42", pr)
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("head lives in 'someone/ark'", ctx.exception.message)

    def test_deleted_fork_head_is_fatal(self):
        pr = self.open_pr(head={"sha": "headsha", "repo": None})
        with self.assertRaises(BumpError) as ctx:
            pr_resolution("42", pr)
        self.assertIn("head lives in 'deleted fork'", ctx.exception.message)

    def test_closed_fork_head_is_fatal(self):
        # The fork head is unbumpable regardless of the closed state, so the fork
        # check raises before the closed warning can matter.
        pr = self.open_pr(
            state="closed",
            head={"sha": "headsha", "repo": {"full_name": "someone/ark"}},
        )
        with self.assertRaises(BumpError) as ctx:
            pr_resolution("42", pr)
        self.assertIn("head lives in", ctx.exception.message)


class ClassifyAncestryTest(unittest.TestCase):
    def test_ahead_continues(self):
        result = classify_ancestry("ahead", 3, 0, "base")
        self.assertEqual(result.merge_base, "base")
        self.assertIsNone(result.exit_code)
        self.assertIn("3 commit(s) ahead", result.messages[0])

    def test_identical_exits_zero(self):
        result = classify_ancestry("identical", 0, 0, "base")
        self.assertEqual(result.exit_code, 0)
        self.assertIn("already at the target", result.messages[0])

    def test_behind_refuses(self):
        result = classify_ancestry("behind", 0, 2, "base")
        self.assertEqual(result.exit_code, 1)
        self.assertIn("already contains the target", result.messages[0])
        self.assertIn("2 commit(s) behind", result.messages[1])

    def test_diverged_warns_but_continues(self):
        result = classify_ancestry("diverged", 1, 4, "base")
        self.assertIsNone(result.exit_code)
        self.assertIn("not based on the current Ark main pointer", result.messages[0])
        self.assertIn("1 ahead, 4 behind", result.messages[1])

    def test_unexpected_status_refuses(self):
        result = classify_ancestry("weird", 0, 0, "base")
        self.assertEqual(result.exit_code, 1)
        self.assertIn("unexpected compare status 'weird'", result.messages[0])


class WalkFirstParentsTest(unittest.TestCase):
    # Linear graph C -> B -> A, plus a root R below A.
    GRAPH = {
        "C": ("subject C", "B"),
        "B": ("subject B", "A"),
        "A": ("subject A", "R"),
        "R": ("subject R", None),
    }

    def get_commit(self, sha):
        return self.GRAPH[sha]

    def test_walks_back_to_but_excludes_from(self):
        walk = walk_first_parents("A", "C", self.get_commit)
        self.assertEqual(walk, [("C", "subject C"), ("B", "subject B")])

    def test_target_equals_from_yields_empty(self):
        self.assertEqual(walk_first_parents("C", "C", self.get_commit), [])

    def test_hitting_root_before_from_is_fatal(self):
        with self.assertRaises(BumpError) as ctx:
            walk_first_parents("Z", "C", self.get_commit)
        self.assertIn("without", ctx.exception.message)
        self.assertIn("reaching the current pointer Z", ctx.exception.message)

    def test_exceeding_max_walk_is_fatal(self):
        with self.assertRaises(BumpError):
            walk_first_parents("A", "C", self.get_commit, max_walk=1)

    def test_max_walk_boundary_reaches_from(self):
        # Two steps (C, B) are exactly enough to reach A.
        walk = walk_first_parents("A", "C", self.get_commit, max_walk=2)
        self.assertEqual([sha for sha, _ in walk], ["C", "B"])


class CommitSummaryTest(unittest.TestCase):
    def test_takes_subject_line_and_first_parent(self):
        commit = {
            "commit": {"message": "Fix the thing\n\nlong body"},
            "parents": [{"sha": "p1"}, {"sha": "p2"}],
        }
        self.assertEqual(commit_summary(commit), ("Fix the thing", "p1"))

    def test_root_commit_has_no_parent(self):
        commit = {"commit": {"message": "Initial"}, "parents": []}
        self.assertEqual(commit_summary(commit), ("Initial", None))


class FirstParentCommitsTest(unittest.TestCase):
    # A complete map means the walk never falls back to `gh_get_commit`, so these
    # run offline. C -> B -> A, with A the merge base.
    COMMIT_MAP = {
        "C": ("subject C", "B"),
        "B": ("subject B", "A"),
    }

    def test_reads_commit_map_without_fetching(self):
        walk = first_parent_commits("A", "C", self.COMMIT_MAP, total_commits=2)
        self.assertEqual(walk, [("C", "subject C"), ("B", "subject B")])

    def test_total_commits_bounds_the_walk(self):
        # A too-small bound trips before the walk can run away fetching commits.
        with self.assertRaises(BumpError):
            first_parent_commits("A", "C", self.COMMIT_MAP, total_commits=1)


class TagLineTest(unittest.TestCase):
    def test_default_is_ark_only(self):
        self.assertEqual(tag_line([]), "@:ark")

    def test_normalizes_bare_tags(self):
        self.assertEqual(tag_line(["win", "console"]), "@:ark @:win @:console")

    def test_keeps_already_prefixed_tags(self):
        self.assertEqual(tag_line(["@:win"]), "@:ark @:win")

    def test_dedupes_preserving_order(self):
        self.assertEqual(tag_line(["win", "@:win", "console"]), "@:ark @:win @:console")

    def test_dedupes_explicit_ark(self):
        self.assertEqual(tag_line(["ark", "@:ark", "win"]), "@:ark @:win")


class AuthorGateTest(unittest.TestCase):
    def test_pr_bump_never_refuses(self):
        self.assertFalse(blocked_by_pr_owner(False, True, "someone", "me", False))

    def test_no_pr_never_refuses(self):
        self.assertFalse(blocked_by_pr_owner(True, False, None, "me", False))

    def test_confirm_overrides(self):
        self.assertFalse(blocked_by_pr_owner(True, True, "someone", "me", True))

    def test_own_pr_is_allowed(self):
        self.assertFalse(blocked_by_pr_owner(True, True, "me", "me", False))

    def test_foreign_pr_refuses(self):
        self.assertTrue(blocked_by_pr_owner(True, True, "someone", "me", False))


class BuildBodyTest(unittest.TestCase):
    def test_omits_closes_block_when_empty(self):
        body = build_body("", "@:ark", "### Release Notes\n\n- x", "- commit")
        self.assertEqual(
            body, "@:ark\n\n### Release Notes\n\n- x\n\n### Commits\n\n- commit"
        )

    def test_leads_with_closes_when_present(self):
        body = build_body("Closes #1", "@:ark", "NOTES", "- commit")
        self.assertTrue(body.startswith("Closes #1\n\n@:ark\n\n"))
        self.assertTrue(body.endswith("### Commits\n\n- commit"))


class CommitLineTest(unittest.TestCase):
    def test_links_subject_to_the_ark_commit(self):
        line = commit_line("abc123", "Fix the thing")
        self.assertEqual(
            line, f"- [Fix the thing](https://github.com/{ARK_REPO}/commit/abc123)"
        )

    def test_pr_reference_stays_inside_the_link_text(self):
        # The `(#1308)` must land inside the link text, not trail after it, so
        # GitHub renders it as literal text instead of autolinking a Positron issue.
        line = commit_line("abc123", "Prevent forking (#1308)")
        self.assertIn("[Prevent forking (#1308)]", line)

    def test_escapes_brackets_in_subject(self):
        line = commit_line("abc123", "Tweak CI [skip ci]")
        self.assertEqual(
            line,
            r"- [Tweak CI \[skip ci\]](https://github.com/"
            + ARK_REPO
            + "/commit/abc123)",
        )


class PrLineTest(unittest.TestCase):
    def test_links_to_the_pr(self):
        line = pr_line(1388, "Add support for Shiny app auto-loading", 12)
        self.assertEqual(
            line,
            "- [Add support for Shiny app auto-loading (#1388)]"
            f"(https://github.com/{ARK_REPO}/pull/1388) (12 unmerged commits)",
        )

    def test_pr_reference_stays_inside_the_link_text(self):
        line = pr_line(42, "Fix the thing", 3)
        self.assertIn("[Fix the thing (#42)]", line)

    def test_singular_commit(self):
        line = pr_line(42, "Fix the thing", 1)
        self.assertIn("(1 unmerged commit)", line)
        self.assertNotIn("commits)", line)

    def test_escapes_brackets_in_title(self):
        line = pr_line(42, "Tweak CI [skip ci]", 2)
        self.assertIn(r"Tweak CI \[skip ci\] (#42)", line)


class StackChainTest(unittest.TestCase):
    def pr(self, number, base_ref, head_ref):
        return UnmergedPr(number, f"PR {number}", "", base_ref, head_ref)

    def test_none_target_yields_empty(self):
        self.assertEqual(stack_chain(None, {}), ([], []))

    def test_four_pr_stack_resolves_top_first(self):
        target = self.pr(1388, "branch-1384", "branch-1388")
        unmerged = {
            1388: target,
            1384: self.pr(1384, "branch-1383", "branch-1384"),
            1383: self.pr(1383, "branch-1382", "branch-1383"),
            1382: self.pr(1382, "main", "branch-1382"),
        }
        chain, messages = stack_chain(target, unmerged)
        self.assertEqual(chain, [1388, 1384, 1383, 1382])
        self.assertEqual(len(messages), 1)
        self.assertIn("#1388 is stacked on #1384, #1383, #1382", messages[0])

    def test_lone_pr_based_on_main_yields_itself(self):
        target = self.pr(42, "main", "branch-42")
        chain, messages = stack_chain(target, {42: target})
        self.assertEqual(chain, [42])
        self.assertEqual(messages, [])

    def test_missing_link_stops_chain_silently(self):
        # A base branch with no unmerged PR of its own is also what an ordinary
        # branch pushed without a PR looks like, so it is not worth a warning.
        target = self.pr(1388, "branch-missing", "branch-1388")
        chain, messages = stack_chain(target, {1388: target})
        self.assertEqual(chain, [1388])
        self.assertEqual(messages, [])

    def test_ref_cycle_terminates(self):
        # A's base is B's head and B's base is A's head, the chain must not loop.
        a = self.pr(1, "branch-b", "branch-a")
        b = self.pr(2, "branch-a", "branch-b")
        chain, _ = stack_chain(a, {1: a, 2: b})
        self.assertEqual(chain, [1, 2])


class GroupWalkTest(unittest.TestCase):
    def test_collapses_pr_commits_into_one_entry(self):
        walk = [("c2", "subject c2"), ("c1", "subject c1")]
        associations = PrAssociations(
            merged_bodies={},
            unmerged={1: UnmergedPr(1, "PR title", "", "main", "branch-1")},
            commit_prs={"c2": [1], "c1": [1]},
        )
        entries = group_walk(walk, associations, [1])
        self.assertEqual(entries, [GroupEntry(1, "c2", "subject c2", 2, "PR title")])

    def test_interleaves_plain_commits(self):
        walk = [("c3", "s3"), ("c2", "s2"), ("c1", "s1")]
        associations = PrAssociations(
            merged_bodies={},
            unmerged={1: UnmergedPr(1, "PR title", "", "main", "branch-1")},
            commit_prs={"c2": [1]},
        )
        entries = group_walk(walk, associations, [1])
        self.assertEqual(
            entries,
            [
                GroupEntry(None, "c3", "s3", 1),
                GroupEntry(1, "c2", "s2", 1, "PR title"),
                GroupEntry(None, "c1", "s1", 1),
            ],
        )

    def test_attributes_shared_commit_to_lowest_chain_pr(self):
        # A commit at the bottom of a stack lists every PR above it too; only the
        # PR closest to Ark main (the last entry in `chain`) is the real owner.
        walk = [("c1", "s1")]
        associations = PrAssociations(
            merged_bodies={},
            unmerged={
                1388: UnmergedPr(1388, "Top", "", "b1384", "b1388"),
                1382: UnmergedPr(1382, "Bottom", "", "main", "b1382"),
            },
            commit_prs={"c1": [1388, 1382]},
        )
        entries = group_walk(walk, associations, [1388, 1382])
        self.assertEqual(entries, [GroupEntry(1382, "c1", "s1", 1, "Bottom")])

    def test_ignores_unmerged_pr_outside_chain(self):
        walk = [("c1", "s1")]
        associations = PrAssociations(
            merged_bodies={},
            unmerged={99: UnmergedPr(99, "Outside", "", "main", "b99")},
            commit_prs={"c1": [99]},
        )
        entries = group_walk(walk, associations, [])
        self.assertEqual(entries, [GroupEntry(None, "c1", "s1", 1)])

    def test_empty_chain_leaves_every_commit_individual(self):
        walk = [("c2", "s2"), ("c1", "s1")]
        associations = PrAssociations({}, {}, {})
        entries = group_walk(walk, associations, [])
        self.assertEqual(
            entries,
            [GroupEntry(None, "c2", "s2", 1), GroupEntry(None, "c1", "s1", 1)],
        )


class ParseArgsTest(unittest.TestCase):
    def test_target_only(self):
        self.assertEqual(parse_args(["main"]), ("main", [], False, False))

    def test_target_and_tags(self):
        self.assertEqual(
            parse_args(["123", "@:win", "@:console"]),
            ("123", ["@:win", "@:console"], False, False),
        )

    def test_confirm_pulled_from_anywhere(self):
        self.assertEqual(
            parse_args(["main", "--confirm", "@:win"]),
            ("main", ["@:win"], True, False),
        )

    def test_dry_run_pulled_from_anywhere(self):
        self.assertEqual(
            parse_args(["main", "--dry-run", "@:win"]),
            ("main", ["@:win"], False, True),
        )

    def test_no_target_exits(self):
        with (
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as ctx,
        ):
            parse_args(["--confirm"])
        self.assertEqual(ctx.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
