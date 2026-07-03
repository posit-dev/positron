#!/usr/bin/env python3
#
# Turn a set of Ark PR descriptions into the `### Release Notes` block and the
# `Closes` issue list for the Positron bump PR body.
#
# The parsing lives in the vendored `parse_description.py` (a copy of
# posit-dev/positron-release-notes). This file is the skill-local glue on top of
# it: it renders the parsed items back into bullets, aggregates the release-notes
# block, and collects the issues to close. Keeping it separate keeps the vendored
# file a clean mirror of upstream.
#
# Input: a JSON array of {number, body} objects (the merged Ark PRs) on stdin.
# Output: JSON {"closes": [issue numbers], "notes": "<block>"} on stdout. The
# `notes` block uses `- N/A` for a category that has none. `closes` unions the
# Positron issues linked inside the emitted release notes with every issue
# referenced by an "Addresses ..." line in the PR bodies.

import json
import re
import sys

from parse_description import Item, ReleaseNotes


def main():
    prs = json.load(sys.stdin)
    json.dump(build_notes(prs), sys.stdout)


# Build the `{closes, notes}` payload for a set of Ark PRs. `prs` is a list of
# {number, body} dicts. `notes` is the `### Release Notes` block; `closes` unions
# the issues linked inside the release notes with the "Addresses ..." references.
def build_notes(prs):
    notes = ReleaseNotes()
    for pr in prs:
        notes.parse_description(pr.get("body") or "", pr_number=pr.get("number"))

    block = "### Release Notes\n\n"
    block += format_section("New Features", notes.features())
    block += "\n\n"
    block += format_section("Bug Fixes", notes.bugfixes())

    closes = linked_issues(notes)
    for pr in prs:
        for issue in addresses_issues(pr.get("body") or ""):
            if issue not in closes:
                closes.append(issue)

    return {"closes": sorted(int(n) for n in closes), "notes": block}


def format_section(title: str, items: list[Item]) -> str:
    body = "\n\n".join(render_item(item) for item in items) if items else "- N/A"
    return f"#### {title}\n\n{body}"


# Render one parsed item back into the bullet form the collector expects when
# it re-parses this bump PR: a `- ` first line and 2-space-indented
# continuation lines. Deliberately without the collector's tag/link/full-stop
# rendering, so the collector applies that once, downstream.
def render_item(item: Item) -> str:
    lines = item.item_text.splitlines()
    if not lines:
        return ""

    lines[0] = "- " + lines[0]
    lines = [
        "  " + line if line and not line.startswith(("-", " ")) else line
        for line in lines
    ]
    lines = [line if line.strip() else "" for line in lines]

    return "\n".join(lines).rstrip()


# Positron issues linked inside the parsed items, deduped preserving first-seen
# order. Lives here rather than on the vendored `ReleaseNotes` so that class stays
# a faithful mirror of upstream.
def linked_issues(notes: ReleaseNotes) -> list[str]:
    issues: list[str] = []
    for item in notes.items:
        for issue in item.linked_issues:
            if issue not in issues:
                issues.append(issue)
    return issues


# Issue references the collector recognizes, all pointing at Positron: a bare
# `#123`, `posit-dev/positron#123`, or the full issues URL.
_ISSUE_REF = r"(?:posit-dev/positron)?#\d+|https://github\.com/posit-dev/positron/issues/\d+"

# "Addresses" followed by one or more of those refs (comma/"and" separated). The
# run stops at the first token that isn't a ref, so a `#N` elsewhere in the same
# sentence isn't swept in.
_ADDRESSES_RE = re.compile(
    r"(?i)\baddresses\b[:\s]+((?:" + _ISSUE_REF + r")(?:\s*(?:,|and)\s*)?)+"
)
_ISSUE_NUM_RE = re.compile(r"#(\d+)|/issues/(\d+)")


def addresses_issues(body: str) -> list[str]:
    body = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    issues = []
    for match in _ADDRESSES_RE.finditer(body):
        for num in _ISSUE_NUM_RE.finditer(match.group(0)):
            issues.append(num.group(1) or num.group(2))
    return issues


if __name__ == "__main__":
    main()
