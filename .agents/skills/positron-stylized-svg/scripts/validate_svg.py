#!/usr/bin/env python3
"""Validate invariants for self-contained Positron walkthrough SVGs."""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

try:
    from PIL import ImageFont
except ImportError:  # pragma: no cover - environment dependent
    ImageFont = None

ALLOWED_COLORS = {color.upper() for color in {
    "#098658", "#333333", "#3A78B1", "#3DAA6E", "#3E4246", "#447099",
    "#5A5A5A", "#8A8A8A", "#8DA5B8", "#B07020", "#C75C5C", "#C8C8C8",
    "#D0D0D0", "#E0E0E0", "#EEEEEE", "#EEF3F8", "#F2F2F2", "#F4F4F4",
    "#F8F8F8", "#FAFAFA", "#FFFFFF",
}}
LANDMARK_TEXT = {
    "EXPLORER", "CONSOLE", "TERMINAL", "SESSION", "VARIABLES", "PLOTS",
    "HELP", "CONNECTIONS", "VIEWER", "HISTORY", "POSIT ASSISTANT",
}
HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?")
NUMBER = re.compile(r"^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))")
URL_FUNCTION = re.compile(r"url\(\s*['\"]?([^)'\"\s]+)", re.IGNORECASE)
DEFAULT_ALIGNMENT_TOLERANCE = 0.25
DEFAULT_BOUNDS_PADDING = 1.0
BOLD_WEIGHTS = {"bold", "600", "700", "800", "900"}

# Where to find each font-family name an SVG might declare, so measurement
# uses the same font the SVG asked for -- falling back through the stack the
# way a browser would -- rather than one hardcoded font. Paths cover the
# common dev machines this skill runs on (macOS, and a couple of Linux/Windows
# fallbacks); missing paths are skipped rather than treated as an error.
FONT_FILES: dict[str, tuple[str, ...]] = {
    "-apple-system": ("/System/Library/Fonts/SFNS.ttf",),
    "blinkmacsystemfont": ("/System/Library/Fonts/SFNS.ttf",),
    "system-ui": ("/System/Library/Fonts/SFNS.ttf",),
    "segoe ui": (
        "C:/Windows/Fonts/segoeui.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ),
    "helvetica neue": ("/System/Library/Fonts/HelveticaNeue.ttc",),
    "helvetica": ("/System/Library/Fonts/Helvetica.ttc",),
    "arial": (
        "C:/Windows/Fonts/arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ),
    "sans-serif": (
        "/System/Library/Fonts/SFNS.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
}
_FONT_CACHE: dict[tuple[str, int], "ImageFont.FreeTypeFont"] = {}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def number(value: str | None) -> float | None:
    if value is None:
        return None
    match = NUMBER.match(value)
    return float(match.group(1)) if match else None


def resolve_font(font_family: str, size_px: int) -> "ImageFont.FreeTypeFont | None":
    """Load the first installed font named in an SVG font-family stack.

    Walks the comma-separated stack the way a browser would, so a measurement
    reflects the actual font the SVG declared rather than one font hardcoded
    into the validator.
    """
    if ImageFont is None:
        return None
    names = [part.strip().strip("'\"").lower() for part in font_family.split(",")]
    for name in names:
        for path in FONT_FILES.get(name, ()):
            if not Path(path).exists():
                continue
            cache_key = (path, size_px)
            if cache_key not in _FONT_CACHE:
                try:
                    _FONT_CACHE[cache_key] = ImageFont.truetype(path, size_px)
                except OSError:
                    continue
            return _FONT_CACHE[cache_key]
    return None


def effective_attr(
    element: ET.Element, attr: str, parent_of: dict[ET.Element, ET.Element]
) -> str | None:
    """Read an attribute from `element`, or the nearest ancestor that sets it.

    Mirrors CSS inheritance for the handful of presentation attributes
    (font-family, font-size, font-weight) this validator cares about: these
    SVGs set them once on a container rather than on every `<text>`.
    """
    node: ET.Element | None = element
    while node is not None:
        value = node.get(attr)
        if value is not None:
            return value
        node = parent_of.get(node)
    return None


def measure_text_width(font: "ImageFont.FreeTypeFont", text: str, letter_spacing: float) -> float:
    width = font.getlength(text) if hasattr(font, "getlength") else font.getsize(text)[0]
    if letter_spacing and len(text) > 1:
        width += letter_spacing * (len(text) - 1)
    return width


def button_bounds_messages(
    pair: ET.Element,
    index: int,
    parent_of: dict[ET.Element, ET.Element],
    root: ET.Element,
    warnings: list[str],
    warned: set[str],
) -> list[str]:
    """Check an icon-label pair's label against an explicit button box.

    Opt-in: only runs when the pair has a direct `data-role="button-bounds"`
    rect child (see references/style.md). A hand-picked button width is a
    common source of a label that overflows its own border -- this catches
    that by measuring the label with the SVG's own declared font rather than
    trusting the author's arithmetic.
    """
    name = pair.get("id") or pair.get("data-name") or f"pair {index}"
    bounds = [child for child in pair if child.get("data-role") == "button-bounds"]
    if not bounds:
        return []
    if len(bounds) != 1 or local_name(bounds[0].tag) != "rect":
        return [
            f"button bounds {name!r} must have at most one direct "
            'data-role="button-bounds" child, which must be a <rect>'
        ]
    rect = bounds[0]
    labels = [child for child in pair if child.get("data-role") == "aligned-label"]
    if len(labels) != 1:
        return []  # already reported by alignment_pair_messages
    label = labels[0]

    text = " ".join("".join(label.itertext()).split())
    if not text:
        return []

    rect_x, rect_w = number(rect.get("x")), number(rect.get("width"))
    if rect_x is None or rect_w is None:
        return [
            f"button bounds {name!r} needs numeric x and width on its "
            'data-role="button-bounds" rect'
        ]

    if ImageFont is None:
        if "pillow" not in warned:
            warned.add("pillow")
            warnings.append(
                "Pillow is not installed; skipping button text-width checks "
                "(pip install pillow to enable them)"
            )
        return []

    font_family = effective_attr(label, "font-family", parent_of) or root.get("font-family")
    font_size = number(effective_attr(label, "font-size", parent_of))
    if not font_family or font_size is None:
        return [
            f"button bounds {name!r} needs a resolvable font-family and numeric "
            "font-size on its label to check text width"
        ]

    font = resolve_font(font_family, round(font_size))
    if font is None:
        cache_key = f"font:{font_family}"
        if cache_key not in warned:
            warned.add(cache_key)
            warnings.append(
                f"no installed font matches font-family {font_family!r}; "
                "skipping button text-width check for labels using it"
            )
        return []

    letter_spacing = number(label.get("letter-spacing")) or 0.0
    width = measure_text_width(font, text, letter_spacing)
    weight = effective_attr(label, "font-weight", parent_of)
    if weight and weight.strip().lower() in BOLD_WEIGHTS:
        # PIL measures the regular weight; a bold label runs a bit wider than
        # that, so nudge the estimate rather than under-flagging it.
        width *= 1.08

    text_x = number(label.get("x"))
    if text_x is None:
        return [f"button bounds {name!r} needs a numeric x on its aligned label"]
    anchor = label.get("text-anchor", "start")
    if anchor == "middle":
        text_left, text_right = text_x - width / 2, text_x + width / 2
    elif anchor == "end":
        text_left, text_right = text_x - width, text_x
    else:
        text_left, text_right = text_x, text_x + width

    padding = number(pair.get("data-min-padding"))
    if padding is None:
        padding = DEFAULT_BOUNDS_PADDING
    rect_left, rect_right = rect_x + padding, rect_x + rect_w - padding

    messages: list[str] = []
    if text_right > rect_right:
        messages.append(
            f"button bounds {name!r}: label {text!r} measured ~{width:g}px wide "
            f"runs {text_right - rect_right:g}px past its button's right edge "
            f"(button right edge {rect_right:g}, text right edge {text_right:g})"
        )
    if text_left < rect_left:
        messages.append(
            f"button bounds {name!r}: label {text!r} starts "
            f"{rect_left - text_left:g}px left of its button's left edge"
        )

    icons = [child for child in pair if child.get("data-role") == "aligned-icon"]
    if icons:
        icon_x = number(icons[0].get("x"))
        if icon_x is not None and icon_x < rect_left:
            messages.append(
                f"button bounds {name!r}: icon starts "
                f"{rect_left - icon_x:g}px left of its button's left edge"
            )
    return messages


def alignment_pair_messages(element: ET.Element, index: int) -> list[str]:
    """Validate one explicitly marked icon-label pair in local coordinates."""
    name = element.get("id") or element.get("data-name") or f"pair {index}"
    icons = [
        child for child in element
        if child.get("data-role") == "aligned-icon"
    ]
    labels = [
        child for child in element
        if child.get("data-role") == "aligned-label"
    ]
    messages: list[str] = []

    if len(icons) != 1 or len(labels) != 1:
        messages.append(
            f"icon-label alignment {name!r} must have exactly one direct "
            'data-role="aligned-icon" child and one direct '
            'data-role="aligned-label" child'
        )
        return messages

    icon, label = icons[0], labels[0]
    icon_y = number(icon.get("y"))
    icon_height = number(icon.get("height"))
    label_y = number(label.get("y"))
    tolerance = number(element.get("data-align-tolerance"))
    if tolerance is None:
        tolerance = DEFAULT_ALIGNMENT_TOLERANCE

    if icon.get("transform") or label.get("transform"):
        messages.append(
            f"icon-label alignment {name!r} uses a transform on an aligned "
            "child; use an explicit icon y/height and label y in the pair's "
            "local coordinate system"
        )
    if icon_y is None or icon_height is None or icon_height <= 0:
        messages.append(
            f"icon-label alignment {name!r} needs numeric y and positive height "
            'on its data-role="aligned-icon" child'
        )
    if local_name(label.tag) != "text" or label_y is None:
        messages.append(
            f"icon-label alignment {name!r} needs a <text> child with numeric y "
            'and data-role="aligned-label"'
        )
    if label.get("dominant-baseline") not in {"middle", "central"}:
        messages.append(
            f"icon-label alignment {name!r} must set dominant-baseline=\"middle\" "
            "or \"central\" on its aligned label"
        )
    if tolerance < 0:
        messages.append(
            f"icon-label alignment {name!r} has a negative data-align-tolerance"
        )

    if messages or icon_y is None or icon_height is None or label_y is None:
        return messages

    icon_center = icon_y + icon_height / 2
    delta = abs(icon_center - label_y)
    if delta > tolerance:
        messages.append(
            f"icon-label alignment {name!r} differs by {delta:g} canvas units "
            f"(icon center {icon_center:g}, label center {label_y:g}, "
            f"tolerance {tolerance:g})"
        )
    return messages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("svg", type=Path)
    parser.add_argument("--strict-palette", action="store_true")
    parser.add_argument("--strict-alignment", action="store_true")
    parser.add_argument("--max-readable-text", type=int, default=18)
    parser.add_argument("--max-placeholders", type=int, default=28)
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    try:
        root = ET.parse(args.svg).getroot()
    except (OSError, ET.ParseError) as exc:
        print(f"ERROR: cannot parse {args.svg}: {exc}")
        return 1

    if local_name(root.tag) != "svg":
        errors.append("root element is not <svg>")

    parent_of = {child: parent for parent in root.iter() for child in parent}
    warned_once: set[str] = set()

    width, height = number(root.get("width")), number(root.get("height"))
    view_box = root.get("viewBox")
    if width is None or height is None:
        errors.append("root must have numeric width and height")
    if not view_box:
        errors.append("root must have a viewBox")
    else:
        try:
            vx, vy, vw, vh = [float(part) for part in view_box.split()]
            if len(view_box.split()) != 4 or vw <= 0 or vh <= 0:
                raise ValueError
            if width is not None and abs(width - vw) > 0.01:
                errors.append(f"width {width:g} differs from viewBox width {vw:g}")
            if height is not None and abs(height - vh) > 0.01:
                errors.append(f"height {height:g} differs from viewBox height {vh:g}")
            if vx != 0 or vy != 0:
                warnings.append("viewBox origin is not 0 0; confirm this is intentional")
        except ValueError:
            errors.append("viewBox must contain four numbers with positive dimensions")

    readable_text: list[str] = []
    placeholders = 0
    unmarked_placeholder_bars = 0
    seen_colors: set[str] = set()
    alignment_pairs = 0
    alignment_messages: list[str] = []
    for element in root.iter():
        tag = local_name(element.tag)
        if tag in {"script", "foreignObject", "iframe", "audio", "video"}:
            errors.append(f"forbidden element <{tag}>")

        for key, value in element.attrib.items():
            key = local_name(key)
            lower = value.lower()
            if key.startswith("on"):
                errors.append(f"event handler attribute {key} is forbidden")
            if key in {"href", "src"}:
                parsed = urlparse(value)
                if parsed.scheme or value.startswith("//"):
                    errors.append(f"external resource is forbidden: {value}")
            if "var(--" in lower:
                errors.append("unresolved CSS variable found")
            if "anthropic sans" in lower:
                errors.append("renderer-specific Anthropic Sans font found")
            for target in URL_FUNCTION.findall(value):
                if not target.startswith("#"):
                    errors.append(f"external CSS url() resource is forbidden: {target}")
            seen_colors.update(color.upper() for color in HEX_COLOR.findall(value))

        if tag == "style":
            css = "".join(element.itertext())
            if "@import" in css.lower():
                errors.append("CSS @import is forbidden")
            if "var(--" in css.lower():
                errors.append("unresolved CSS variable found in <style>")
            seen_colors.update(color.upper() for color in HEX_COLOR.findall(css))

        if tag == "text":
            text = " ".join("".join(element.itertext()).split())
            if text:
                readable_text.append(text)
        if element.get("data-role") == "placeholder":
            placeholders += 1
        if element.get("data-role") == "icon-label-pair":
            alignment_pairs += 1
            alignment_messages.extend(
                alignment_pair_messages(element, alignment_pairs)
            )
            alignment_messages.extend(
                button_bounds_messages(
                    element, alignment_pairs, parent_of, root, warnings, warned_once
                )
            )
        if (
            tag == "rect"
            and element.get("data-role") != "placeholder"
            and (element.get("fill") or "").upper() in {"#C8C8C8", "#D0D0D0"}
            and (number(element.get("width")) or 0) >= 8
            and (number(element.get("height")) or 999) <= 8
        ):
            unmarked_placeholder_bars += 1

    if len(readable_text) > args.max_readable_text:
        warnings.append(
            f"{len(readable_text)} readable text elements exceed the default "
            f"budget of {args.max_readable_text}; confirm each is a landmark"
        )
    incidental = [
        text for text in readable_text
        if len(text) > 18 and text.upper() not in LANDMARK_TEXT
    ]
    if incidental:
        warnings.append(
            "long readable text may be incidental content: "
            + ", ".join(repr(text) for text in incidental[:4])
        )
    if placeholders > args.max_placeholders:
        errors.append(
            f"{placeholders} placeholders exceed the budget of "
            f"{args.max_placeholders}; remove repetitive visual texture"
        )
    if unmarked_placeholder_bars:
        warnings.append(
            f"{unmarked_placeholder_bars} likely placeholder bars are not marked "
            'data-role="placeholder"'
        )

    unknown = sorted(color for color in seen_colors if color not in ALLOWED_COLORS)
    if unknown:
        message = "colors outside the compact palette: " + ", ".join(unknown)
        (errors if args.strict_palette else warnings).append(message)
    if alignment_messages:
        (errors if args.strict_alignment else warnings).extend(alignment_messages)

    errors = list(dict.fromkeys(errors))
    warnings = list(dict.fromkeys(warnings))
    for message in errors:
        print(f"ERROR: {message}")
    for message in warnings:
        print(f"WARNING: {message}")
    if not errors:
        print(
            f"OK: {args.svg} ({len(readable_text)} readable text elements, "
            f"{placeholders} marked placeholders, {len(seen_colors)} colors, "
            f"{alignment_pairs} alignment pairs)"
        )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
