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
    blocked_by_pr_owner,
    build_body,
    classify_ancestry,
    commit_summary,
    first_parent_commits,
    parse_args,
    pr_resolution,
    tag_line,
    walk_first_parents,
)


class DecidePrResolutionTest(unittest.TestCase):
    def open_pr(self, **overrides):
        pr = {
            "head": {"sha": "headsha", "repo": {"full_name": ARK_REPO}},
            "state": "open",
            "merged_at": None,
            "merge_commit_sha": None,
        }
        pr.update(overrides)
        return pr

    def test_open_pr_targets_head_and_sets_open_pr_number(self):
        resolution, messages = pr_resolution("42", self.open_pr())
        self.assertEqual(resolution.sha, "headsha")
        self.assertEqual(resolution.title, "Bump Ark to posit-dev/ark#42")
        self.assertEqual(resolution.branch, "bump-ark/pr-42")
        self.assertEqual(resolution.open_pr_number, "42")
        self.assertTrue(resolution.is_pr_bump)
        self.assertEqual(messages, [])

    def test_merged_pr_targets_merge_commit_and_clears_open_pr_number(self):
        pr = self.open_pr(
            merged_at="2026-01-01T00:00:00Z",
            merge_commit_sha="mergesha",
            state="closed",
        )
        resolution, messages = pr_resolution("42", pr)
        self.assertEqual(resolution.sha, "mergesha")
        self.assertIsNone(resolution.open_pr_number)
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
        self.assertEqual(resolution.open_pr_number, "42")
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


class ParseArgsTest(unittest.TestCase):
    def test_target_only(self):
        self.assertEqual(parse_args(["main"]), ("main", [], False))

    def test_target_and_tags(self):
        self.assertEqual(
            parse_args(["123", "@:win", "@:console"]),
            ("123", ["@:win", "@:console"], False),
        )

    def test_confirm_pulled_from_anywhere(self):
        self.assertEqual(
            parse_args(["main", "--confirm", "@:win"]), ("main", ["@:win"], True)
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
