# /// script
# requires-python = ">=3.11"
# ///
"""Show package version changes in positron-python's pinned Python requirements.

Compares each pinned requirements file and python_files/posit/uv.lock at a git ref
against the working tree, and flags major version jumps for review.

Usage (from the repository root):
    uv run .claude/skills/positron-python-upstream-merge/scripts/req_diff.py [base-ref]
"""

import re
import subprocess
import sys
import tomllib
from pathlib import Path

SUBDIR = Path("extensions/positron-python")
REQUIREMENTS_FILES = [
    "requirements.txt",
    "python_files/ipykernel_requirements/py3-requirements.txt",
    "python_files/ipykernel_requirements/cp3-requirements.txt",
    "python_files/ipykernel_requirements/cpx-requirements.txt",
    "python_files/positron_requirements/requirements.txt",
]
UV_LOCK = "python_files/posit/uv.lock"

_PIN = re.compile(r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)==(?P<version>[^\s;\\]+)")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(text: str) -> dict[str, set[str]]:
    """Map package name to pinned versions in a pip requirements file."""
    pins: dict[str, set[str]] = {}
    for line in text.splitlines():
        match = _PIN.match(line.strip())
        if match:
            pins.setdefault(normalize(match["name"]), set()).add(match["version"])
    return pins


def parse_uv_lock(text: str) -> dict[str, set[str]]:
    """Map package name to locked versions in a uv.lock file."""
    pins: dict[str, set[str]] = {}
    for package in tomllib.loads(text).get("package", []):
        if "version" in package:
            pins.setdefault(normalize(package["name"]), set()).add(package["version"])
    return pins


def release_line(version: str) -> tuple[str, ...]:
    """The part of a version that a major bump changes: the first number, or the second for 0.x."""
    parts = re.findall(r"\d+", version)[:2]
    if not parts:
        return (version,)
    return tuple(parts) if parts[0] == "0" else (parts[0],)


def diff_pins(
    old: dict[str, set[str]], new: dict[str, set[str]]
) -> list[tuple[str, str, str, bool]]:
    """Return (name, old versions, new versions, major) rows for changed packages."""
    rows = []
    for name in sorted(old.keys() | new.keys()):
        before, after = old.get(name, set()), new.get(name, set())
        if before == after:
            continue
        old_lines = {release_line(version) for version in before}
        major = bool(before) and any(release_line(version) not in old_lines for version in after)
        rows.append(
            (name, ", ".join(sorted(before)) or "-", ", ".join(sorted(after)) or "-", major)
        )
    return rows


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False)


def read_at_ref(ref: str, path: Path) -> str:
    """Return the file's content at ref, or "" when the file does not exist at ref."""
    spec = f"{ref}:{path.as_posix()}"
    if git("cat-file", "-e", spec).returncode != 0:
        return ""
    result = git("show", spec)
    if result.returncode != 0:
        raise RuntimeError(f"git show {spec} failed: {result.stderr.strip()}")
    return result.stdout


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
    if git("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}").returncode != 0:
        print(f"Unknown base ref {base!r}. Pass a commit, branch, or tag.", file=sys.stderr)
        return 2
    found_major = False
    for rel in [*REQUIREMENTS_FILES, UV_LOCK]:
        path = SUBDIR / rel
        if not path.exists():
            print(f"{path}: missing in working tree", file=sys.stderr)
            continue
        parse = parse_uv_lock if rel == UV_LOCK else parse_requirements
        rows = diff_pins(parse(read_at_ref(base, path)), parse(path.read_text()))
        print(f"\n## {path} ({len(rows)} changed)")
        for name, before, after, major in rows:
            flag = "  MAJOR" if major else ""
            found_major = found_major or major
            print(f"{name:32} {before:>20} -> {after}{flag}")
    if found_major:
        print("\nMAJOR rows need a changelog read and a validation note in the PR.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
