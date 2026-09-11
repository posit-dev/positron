#!/usr/bin/env python3
"""Validate invariants for self-contained Positron walkthrough SVGs."""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

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


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def number(value: str | None) -> float | None:
    if value is None:
        return None
    match = NUMBER.match(value)
    return float(match.group(1)) if match else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("svg", type=Path)
    parser.add_argument("--strict-palette", action="store_true")
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

    errors = list(dict.fromkeys(errors))
    warnings = list(dict.fromkeys(warnings))
    for message in errors:
        print(f"ERROR: {message}")
    for message in warnings:
        print(f"WARNING: {message}")
    if not errors:
        print(
            f"OK: {args.svg} ({len(readable_text)} readable text elements, "
            f"{placeholders} marked placeholders, {len(seen_colors)} colors)"
        )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
