#!/usr/bin/env python3
"""Tests for Positron stylized SVG validation safeguards."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


VALIDATOR = Path(__file__).with_name("validate_svg.py")
EXTRACTOR = Path(__file__).with_name("extract_icon.py")
REPO = Path(__file__).resolve().parents[4]

# Button-bounds text-width checks need a real font on disk to measure against.
# Kept in sync with validate_svg.FONT_FILES's "sans-serif" fallbacks; skip
# rather than fail on a machine with none of them installed.
_MEASURABLE_FONT_PATHS = (
    "/System/Library/Fonts/SFNS.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def has_measurable_font() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return any(Path(path).exists() for path in _MEASURABLE_FONT_PATHS)


def svg(pair: str) -> str:
    return f"""\
<svg width="100" height="50" viewBox="0 0 100 50"
     xmlns="http://www.w3.org/2000/svg">
  {pair}
</svg>
"""


class IconLabelAlignmentTests(unittest.TestCase):
    def validate(self, source: str, strict: bool = True) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "fixture.svg"
            path.write_text(source)
            command = ["python3", str(VALIDATOR)]
            if strict:
                command.append("--strict-alignment")
            command.append(str(path))
            return subprocess.run(command, capture_output=True, text=True)

    def test_accepts_matching_centers(self) -> None:
        result = self.validate(svg("""
<g data-role="icon-label-pair" data-name="aligned">
  <svg data-role="aligned-icon" x="10" y="14" width="12" height="12"
       viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
  <text data-role="aligned-label" x="28" y="20"
        dominant-baseline="middle">Label</text>
</g>"""))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 alignment pairs", result.stdout)

    def test_rejects_mismatched_centers_in_strict_mode(self) -> None:
        result = self.validate(svg("""
<g data-role="icon-label-pair" data-name="misaligned">
  <svg data-role="aligned-icon" x="10" y="12" width="12" height="12"
       viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
  <text data-role="aligned-label" x="28" y="20"
        dominant-baseline="middle">Label</text>
</g>"""))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("differs by 2 canvas units", result.stdout)

    def test_reports_mismatch_as_warning_without_strict_mode(self) -> None:
        result = self.validate(svg("""
<g data-role="icon-label-pair" data-name="misaligned">
  <svg data-role="aligned-icon" x="10" y="12" width="12" height="12"
       viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
  <text data-role="aligned-label" x="28" y="20"
        dominant-baseline="middle">Label</text>
</g>"""), strict=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("WARNING: icon-label alignment", result.stdout)

    def test_requires_middle_baseline(self) -> None:
        result = self.validate(svg("""
<g data-role="icon-label-pair" data-name="baseline">
  <svg data-role="aligned-icon" x="10" y="14" width="12" height="12"
       viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
  <text data-role="aligned-label" x="28" y="20">Label</text>
</g>"""))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must set dominant-baseline="middle"', result.stdout)


class ButtonBoundsTests(unittest.TestCase):
    def validate(self, source: str, strict: bool = True) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "fixture.svg"
            path.write_text(source)
            command = ["python3", str(VALIDATOR)]
            if strict:
                command.append("--strict-alignment")
            command.append(str(path))
            return subprocess.run(command, capture_output=True, text=True)

    @unittest.skipUnless(has_measurable_font(), "no measurable system font available")
    def test_accepts_label_within_bounds(self) -> None:
        result = self.validate(svg("""
<g font-family="sans-serif">
  <g data-role="icon-label-pair" data-name="wide-button">
    <rect data-role="button-bounds" x="10" y="10" width="90" height="24"/>
    <svg data-role="aligned-icon" x="18" y="15" width="14" height="14"
         viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
    <text data-role="aligned-label" x="38" y="22" font-size="12"
          dominant-baseline="middle">Help</text>
  </g>
</g>"""))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(has_measurable_font(), "no measurable system font available")
    def test_rejects_label_overflowing_button_in_strict_mode(self) -> None:
        # A button hand-sized too narrow for its own label -- the exact bug
        # this check exists to catch.
        result = self.validate(svg("""
<g font-family="sans-serif">
  <g data-role="icon-label-pair" data-name="narrow-button">
    <rect data-role="button-bounds" x="10" y="10" width="40" height="24"/>
    <svg data-role="aligned-icon" x="14" y="15" width="14" height="14"
         viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
    <text data-role="aligned-label" x="32" y="22" font-size="12"
          dominant-baseline="middle">Release Notes</text>
  </g>
</g>"""))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("past its button's right edge", result.stdout)

    @unittest.skipUnless(has_measurable_font(), "no measurable system font available")
    def test_reports_overflow_as_warning_without_strict_mode(self) -> None:
        result = self.validate(svg("""
<g font-family="sans-serif">
  <g data-role="icon-label-pair" data-name="narrow-button">
    <rect data-role="button-bounds" x="10" y="10" width="40" height="24"/>
    <svg data-role="aligned-icon" x="14" y="15" width="14" height="14"
         viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
    <text data-role="aligned-label" x="32" y="22" font-size="12"
          dominant-baseline="middle">Release Notes</text>
  </g>
</g>"""), strict=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("WARNING: button bounds", result.stdout)

    def test_skips_gracefully_when_font_cannot_be_resolved(self) -> None:
        # No Pillow, or no font on disk for this family: either way the
        # validator should skip the check with a warning, not fail closed.
        result = self.validate(svg("""
<g font-family="ThisFontDoesNotExistAnywhere">
  <g data-role="icon-label-pair" data-name="unresolvable-font">
    <rect data-role="button-bounds" x="10" y="10" width="40" height="24"/>
    <svg data-role="aligned-icon" x="14" y="15" width="14" height="14"
         viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
    <text data-role="aligned-label" x="32" y="22" font-size="12"
          dominant-baseline="middle">Release Notes</text>
  </g>
</g>"""))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(
            "Pillow is not installed" in result.stdout
            or "no installed font matches" in result.stdout
        )

    def test_ignores_pairs_without_button_bounds(self) -> None:
        result = self.validate(svg("""
<g data-role="icon-label-pair" data-name="no-bounds">
  <svg data-role="aligned-icon" x="10" y="14" width="12" height="12"
       viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/></svg>
  <text data-role="aligned-label" x="28" y="20"
        dominant-baseline="middle">Label</text>
</g>"""))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class AlignedIconExtractionTests(unittest.TestCase):
    def test_emits_explicit_box_centered_on_requested_y(self) -> None:
        result = subprocess.run(
            [
                "python3",
                str(EXTRACTOR),
                "--repo",
                str(REPO),
                "codicon",
                "pass",
                "--aligned-box",
                "36",
                "113",
                "14",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        icon = ET.fromstring(result.stdout)
        self.assertEqual(icon.get("data-role"), "aligned-icon")
        self.assertEqual(icon.get("x"), "36")
        self.assertEqual(icon.get("y"), "106")
        self.assertEqual(icon.get("width"), "14")
        self.assertEqual(icon.get("height"), "14")


if __name__ == "__main__":
    unittest.main()
