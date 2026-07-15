#!/usr/bin/env python3
#
# Unit tests for the skill-local release-notes glue in bump_notes.py: the section
# rendering and the `Closes` collection wrapped around the vendored parser. Run
# offline:
#
#   python3 -m unittest test_bump_notes
#
# The vendored parser (`parse_description.py`: `Item`, `DescriptionParser`,
# `trim_empty_lines`) is tested upstream in posit-dev/positron-release-notes; the
# tests here cover the parts written for this skill (`linked_issues`,
# `render_item`, `format_section`, `addresses_issues`, `build_notes`).

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bump_notes import (  # noqa: E402
    addresses_issues,
    build_notes,
    format_section,
    linked_issues,
    render_item,
)
from parse_description import Item, ReleaseNotes  # noqa: E402


class RenderItemTest(unittest.TestCase):
    def test_single_line_gets_bullet_prefix(self):
        self.assertEqual(render_item(Item("Fix the crash", "bugfix")), "- Fix the crash")

    def test_continuation_lines_are_indented(self):
        item = Item("First line\nsecond line", "feature")
        self.assertEqual(render_item(item), "- First line\n  second line")

    def test_already_indented_continuation_is_left_alone(self):
        item = Item("First line\n  - nested bullet", "feature")
        self.assertEqual(render_item(item), "- First line\n  - nested bullet")


class FormatSectionTest(unittest.TestCase):
    def test_empty_section_renders_na(self):
        self.assertEqual(format_section("New Features", []), "#### New Features\n\n- N/A")

    def test_single_item(self):
        items = [Item("Did a thing", "feature")]
        self.assertEqual(format_section("New Features", items), "#### New Features\n\n- Did a thing")

    def test_items_separated_by_blank_line(self):
        items = [Item("One", "feature"), Item("Two", "feature")]
        self.assertEqual(
            format_section("New Features", items),
            "#### New Features\n\n- One\n\n- Two",
        )


class LinkedIssuesTest(unittest.TestCase):
    def test_dedupes_across_items_preserving_order(self):
        notes = ReleaseNotes()
        notes.items = [
            Item("Fixes #10", "bugfix"),
            Item("Also touches #20", "feature"),
            Item("Again #10", "bugfix"),
        ]
        self.assertEqual(linked_issues(notes), ["10", "20"])


class AddressesIssuesTest(unittest.TestCase):
    def test_bare_hash_reference(self):
        self.assertEqual(addresses_issues("Addresses #123"), ["123"])

    def test_comma_and_and_separated_run(self):
        self.assertEqual(addresses_issues("Addresses #1, #2 and #3"), ["1", "2", "3"])

    def test_qualified_and_url_references(self):
        self.assertEqual(
            addresses_issues("Addresses posit-dev/positron#42"), ["42"]
        )
        self.assertEqual(
            addresses_issues("Addresses https://github.com/posit-dev/positron/issues/50"),
            ["50"],
        )

    def test_references_inside_comments_are_ignored(self):
        self.assertEqual(addresses_issues("<!-- Addresses #9 -->"), [])

    def test_no_addresses_keyword_yields_nothing(self):
        self.assertEqual(addresses_issues("See #7 for details"), [])

    def test_matches_keyword_mid_sentence_case_insensitively(self):
        # The regex is not anchored to a leading "Addresses" line, so any
        # "addresses <ref>" is swept in; this pins that behavior.
        self.assertEqual(addresses_issues("This addresses #5 fully."), ["5"])


class BuildNotesTest(unittest.TestCase):
    def test_aggregates_sections_and_unions_closes(self):
        body = (
            "### Release Notes\n\n"
            "#### New Features\n\n"
            "- Added a shiny thing (#100).\n\n"
            "#### Bug Fixes\n\n"
            "- Fixed a crash (posit-dev/positron#200).\n\n"
            "### QA Notes\n\n"
            "Addresses #300 and #301.\n"
        )
        result = build_notes([{"number": 1, "body": body}])

        self.assertEqual(
            result["notes"],
            "### Release Notes\n\n"
            "#### New Features\n\n"
            "- Added a shiny thing (https://github.com/posit-dev/positron/issues/100).\n\n"
            "#### Bug Fixes\n\n"
            "- Fixed a crash (https://github.com/posit-dev/positron/issues/200).",
        )
        # Union of bullet-linked issues (100, 200) and "Addresses" refs (300, 301).
        self.assertEqual(result["closes"], [100, 200, 300, 301])

    def test_empty_category_renders_na(self):
        body = "#### Bug Fixes\n\n- Fixed something.\n"
        result = build_notes([{"number": 1, "body": body}])
        self.assertIn("#### New Features\n\n- N/A", result["notes"])
        self.assertEqual(result["closes"], [])


if __name__ == "__main__":
    unittest.main()
