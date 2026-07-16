#!/usr/bin/env python3
#
# Parse `#### New Features` / `#### Bug Fixes` bullets out of a PR description.
#
# Vendored from posit-dev/positron-release-notes (`parse_description.py`) so
# extraction matches the release-notes collector exactly. Keep this file a clean
# mirror of upstream: the `ghapi` dependency and the release-doc rendering
# (`Item.text`, `ReleaseNotes.print`, language-label fetching) are the only
# things dropped, since here we only extract the raw bullets. The skill-local
# rendering and aggregation lives in `bump_notes.py`, not here.

import re
from typing import Optional


class Item:
    item_text: str
    type: str
    pr_number: Optional[int]

    def __init__(self, item: str, item_type: str, pr_number: Optional[int] = None):
        if item_type not in ["feature", "bugfix"]:
            raise ValueError(
                f"Item type must be 'feature' or 'bugfix', not '{item_type}'"
            )
        self.type = item_type

        item = item.lstrip("- ")
        self.item_text = item

        self.pr_number = pr_number

        self._parse_linked_issues()

    def _parse_linked_issues(self):
        # Normalise links to issues
        self.item_text = re.sub(
            r"posit-dev/positron#(\d+)",
            r"https://github.com/posit-dev/positron/issues/\1",
            self.item_text,
        )
        self.item_text = re.sub(
            r"#(\d+)",
            r"https://github.com/posit-dev/positron/issues/\1",
            self.item_text,
        )

        linked_issues = re.findall(
            r"https://github.com/posit-dev/positron/issues/(\d+)", self.item_text
        )
        self.linked_issues = list(set(linked_issues))


class ReleaseNotes:
    items: list[Item]

    def __init__(self):
        self.items = []

    def features(self) -> list[Item]:
        return [item for item in self.items if item.type == "feature"]

    def bugfixes(self) -> list[Item]:
        return [item for item in self.items if item.type == "bugfix"]

    def parse_description(self, desc: str, pr_number: Optional[int] = None):
        parser = DescriptionParser(pr_number=pr_number)
        parser.parse(desc)
        self.items.extend(parser.items)


class DescriptionParser:
    items: list[Item]

    _current_item: list[str]
    _current_section: Optional[str]
    _in_comment: bool
    _pr_number: Optional[int]

    def __init__(self, pr_number: Optional[int] = None):
        self.items = []
        self._current_item = []
        self._current_section = None
        self._in_comment = False
        self._pr_number = pr_number

    def parse(self, desc: str):
        lines = desc.splitlines()
        for line in lines:
            self._parse_line(line)
        self._flush()

    def _flush(self):
        lines = trim_empty_lines(self._current_item)
        text = "\n".join(lines)
        self._current_item = []

        if self._current_section is not None and len(text) > 0:
            self.items.append(Item(text, self._current_section, self._pr_number))

    def _parse_line(self, line: str):
        if "<!--" in line:
            self._in_comment = True
            return

        if "-->" in line:
            self._in_comment = False
            return

        # Skip lines within comments
        if self._in_comment:
            return

        # Enter known sections. For simplicity we don't check that we're within
        # the `### Release Notes` header.
        if re.match(r"^####\ New\ Features", line):
            self._flush()
            self._current_section = "feature"
            return

        if re.match(r"^####\ Bug\ Fixes", line):
            self._flush()
            self._current_section = "bugfix"
            return

        # Reset section for any other headers, e.g. `QA Notes`
        if re.match(r"^#", line):
            self._flush()
            self._current_section = None
            return

        # We're not in a relevant section, ignore the line
        if self._current_section == "":
            return

        # Normalize `*` bullets to `-`
        if re.match(r"^\*", line):
            line = "- " + line[2:]

        # Ignore unindented lines - they are not part of an item
        if line.strip() and not re.match(r"^(  |- )", line):
            return

        # Start new line
        if re.match(r"^-\ ", line):
            self._flush()

            # Ignore N/A line
            if re.match(r"^-\ N/A", line):
                # Ignore N/A line
                return

        self._current_item.append(line)


def trim_empty_lines(lines):
    # Trim leading lines
    while len(lines) > 0:
        if re.match(r"^\s*$", lines[0]):
            lines.pop(0)
        else:
            break

    # Trim trailing lines
    while len(lines) > 0:
        if re.match(r"^\s*$", lines[-1]):
            lines.pop()
        else:
            break

    return lines
