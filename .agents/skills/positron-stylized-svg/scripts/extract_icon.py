#!/usr/bin/env python3
"""Extract SVG-ready codicon or Seti paths from the current checkout."""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "extensions").is_dir() and (candidate / "src").is_dir():
            return candidate
    raise SystemExit("run from inside a Positron checkout or pass --repo")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def codicon(repo: Path, name: str) -> None:
    path = repo / "node_modules/@vscode/codicons/src/icons" / f"{name}.svg"
    resolved_from = None
    if not path.exists():
        pattern = re.compile(
            rf"registerIcon\(\s*['\"]{re.escape(name)}['\"]\s*,\s*Codicon\.([A-Za-z0-9_]+)"
        )
        workbench = repo / "src/vs/workbench"
        for source in workbench.rglob("*.ts"):
            match = pattern.search(source.read_text(errors="ignore"))
            if match:
                codicon_name = re.sub(
                    r"(?<!^)(?=[A-Z])", "-", match.group(1)
                ).lower()
                candidate = (
                    repo / "node_modules/@vscode/codicons/src/icons"
                    / f"{codicon_name}.svg"
                )
                if candidate.exists():
                    path = candidate
                    resolved_from = source.relative_to(repo)
                    break
        if not path.exists():
            raise SystemExit(
                f"codicon or registered product icon not found: {name}"
            )
    root = ET.parse(path).getroot()
    paths = [node for node in root.iter() if local_name(node.tag) == "path"]
    alias = f"; product-icon-source={resolved_from}" if resolved_from else ""
    print(
        f"<!-- source: {path.relative_to(repo)}{alias}; "
        f"viewBox={root.get('viewBox')} -->"
    )
    for node in paths:
        attrs = []
        for key in ("fill-rule", "clip-rule", "d"):
            if node.get(key):
                attrs.append(f'{key}="{node.get(key)}"')
        print("<path " + " ".join(attrs) + "/>")


def decode_character(value: str) -> int:
    stripped = value.removeprefix("\\")
    return int(stripped, 16)


def seti(repo: Path, extension: str | None, filename: str | None) -> None:
    try:
        from fontTools.misc.transform import Transform
        from fontTools.pens.boundsPen import BoundsPen
        from fontTools.pens.svgPathPen import SVGPathPen
        from fontTools.pens.transformPen import TransformPen
        from fontTools.ttLib import TTFont
    except ImportError as exc:
        raise SystemExit("Seti extraction requires fontTools") from exc

    theme_path = repo / "extensions/theme-seti/icons/vs-seti-icon-theme.json"
    theme = json.loads(theme_path.read_text())
    if filename:
        definition = theme.get("fileNames", {}).get(filename.lower())
        lookup = f"filename {filename!r}"
    else:
        normalized = (extension or "").lower().removeprefix(".")
        definition = theme.get("fileExtensions", {}).get(normalized)
        lookup = f"extension {normalized!r}"
    definition = definition or theme.get("file")
    if not definition:
        raise SystemExit(f"no Seti definition for {lookup}")
    light_definition = f"{definition}_light"
    definitions = theme["iconDefinitions"]
    if light_definition in definitions:
        definition = light_definition
    icon = definitions[definition]
    codepoint = decode_character(icon["fontCharacter"])

    font_path = repo / "extensions/theme-seti/icons/seti.woff"
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    glyph_name = font.getBestCmap().get(codepoint)
    if glyph_name is None:
        raise SystemExit(f"font has no glyph for U+{codepoint:04X}")
    glyph = glyph_set[glyph_name]
    bounds_pen = BoundsPen(glyph_set)
    glyph.draw(bounds_pen)
    xmin, ymin, xmax, ymax = bounds_pen.bounds
    width, height = xmax - xmin, ymax - ymin
    scale = 16.0 / max(width, height)
    tx = (16 - width * scale) / 2 - xmin * scale
    ty = (16 - height * scale) / 2 + ymax * scale
    pen = SVGPathPen(glyph_set, ntos=lambda value: f"{value:.2f}")
    glyph.draw(TransformPen(pen, Transform(scale, 0, 0, -scale, tx, ty)))
    color = icon.get("fontColor", "#8A8A8A")
    print(
        f"<!-- source: {font_path.relative_to(repo)}; definition={definition}; "
        f"codepoint=U+{codepoint:04X}; theme-color={color}; viewBox=0 0 16 16 -->"
    )
    print(f'<path d="{pen.getCommands()}"/>')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path)
    subparsers = parser.add_subparsers(dest="kind", required=True)
    codicon_parser = subparsers.add_parser("codicon")
    codicon_parser.add_argument("name")
    seti_parser = subparsers.add_parser("seti")
    group = seti_parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--extension")
    group.add_argument("--filename")
    args = parser.parse_args()

    repo = (args.repo.resolve() if args.repo else repo_root(Path.cwd().resolve()))
    if args.kind == "codicon":
        codicon(repo, args.name)
    else:
        seti(repo, args.extension, args.filename)
    return 0


if __name__ == "__main__":
    sys.exit(main())
