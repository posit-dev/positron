---
name: positron-abstract-svg
description: >
  Create or update abstract SVG illustrations for the Positron IDE — for use in
  documentation, walkthrough steps, onboarding images, and feature previews.
  Use this skill whenever someone asks to make, update, or redesign an SVG image
  for Positron docs, walkthroughs, or any visual asset representing the Positron
  IDE UI. Also use it when asked to make images "consistent" with existing
  Positron walkthrough images, or to add a new image to match an existing set.
  Trigger on: "make an SVG for the walkthrough", "create an abstract image for
  the notebook feature", "update the hero image", "make it look like the other
  Positron SVGs", "add a docs image for X feature".
---

# Positron Abstract SVG Skill

This skill helps you create clean, on-brand abstract SVG illustrations of the
Positron IDE for use in documentation and in-app walkthroughs.

## Critical Constraints

**These SVGs are loaded as `<img src="...">` inside a VS Code webview.** This means:

- **No CSS variables** — `var(--vscode-editor-background)` will NOT work. All colors must be hardcoded hex values.
- **No JavaScript** — static SVG only.
- **Light theme only** — these images are always shown in a light context.
- **Standard walkthrough size**: `width="520" height="260"` (can vary for other uses).

Always start every SVG with a white background rect:
```svg
<rect width="520" height="260" fill="#FFFFFF"/>
```

## Color Palette

| Color | Hex | Use |
|-------|-----|-----|
| Positron blue | `#447099` | Active tab underline, active cell border, Python dropdown border, focal-point highlights only — use sparingly |
| Running kernel green | `#3DAA6E` | Session status dot in kernel/Python dropdown |
| Icon gray | `#5A5A5A` | All toolbar and action bar icons |
| Line number blue | `#8DA5B8` | Code cell line numbers |
| Code placeholder | `#C8C8C8` | Gray rects representing code lines |
| Output placeholder | `#D0D0D0` | X-axis tick labels and secondary placeholder rects |
| Panel header bg | `#F4F4F4` | Panel headers (Variables, Posit Assistant) |
| Toolbar bg | `#FAFAFA` | Notebook toolbar background |
| Tab bar bg | `#F2F2F2` | Inactive tab area |
| Active tab bg | `#FFFFFF` | Active file tab |
| Cell separator | `#EEEEEE` | Line between code area and output area in cells |
| Panel separator | `#E0E0E0` | Vertical dividers between panels; toolbar bottom border |
| Inactive cell bg | `#F8F8F8` | Gray background of code area inside cells |
| Highlighted row | `#EEF3F8` | Selected/highlighted row in variables pane |
| Syntax: variable | `#447099` | Variable names in code (blue) |
| Syntax: number/value | `#098658` | Numbers and values in code (green) |
| Syntax: function | `#C75C5C` | Function names like `print` (red) |
| Syntax: string | `#B07020` | String literals (orange-brown) |
| Header text | `#3E4246` | Panel header labels |
| Body text | `#333333` | Tab labels and readable text |
| Muted text | `#8A8A8A` | Execution count `[n]`, secondary labels |

## Gathering Input Before You Start

The more context you have about the actual UI, the better the abstract image will be. Ask the user for:

- **A screenshot of the actual Positron UI** being depicted — this shows exact proportions, which elements are present, and what the focal point should be. If no screenshot is available, describe what you plan to show and confirm with the user.
- **Codicon names for any toolbar or action bar icons** — e.g., `notebook-execute`, `debug-alt-small`, `run-above`. Look up the SVG path data in `references/codicons.md`. If a codicon isn't there, search the Positron codebase in `node_modules/@vscode/codicons/src/icons/` for the `.svg` file.
- **File type icons** — Positron uses the [Seti UI](https://github.com/jesseweed/seti-ui) file icon theme. If the image should show a tab with a file icon (`.ipynb`, `.R`, `.py`, `.csv`, etc.), fetch the relevant SVG from that repo and inline it into the tab bar.

## Workflow

1. **Gather input** — screenshot of the UI, icon names, file types (see above).
2. **Plan the layout** — decide what panels/components to show and their proportions.
3. **Sketch in SVG** — write the SVG, starting with background elements, then building up layers.
4. **Preview** — always use `show_widget` to render a preview before saving to file. This catches layout issues early.
5. **Iterate** — adjust based on the preview, re-render, repeat until it looks right.
6. **Save** — write the final SVG to the correct path in the repository.

## SVG Layering (Z-order)

SVG renders elements in document order — later elements appear on top. Keep this in mind:

- Draw cell borders and backgrounds **before** their content.
- Draw **cell action bars after** their parent cell, so the action bar floats on top.
- Draw **panel separator lines** early so content overlaps them correctly.

## Fonts

- **UI labels, tab names, panel headers**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Code and line numbers**: `'Consolas', 'SF Mono', 'Menlo', monospace`

## Code Representation

Never write real readable code in these illustrations unless the content is the focal point of the image. Use placeholder gray rects instead:

```svg
<!-- Good: placeholder code lines -->
<rect x="58" y="90" width="200" height="4" rx="2" fill="#C8C8C8"/>
<rect x="58" y="102" width="80" height="4" rx="2" fill="#C8C8C8"/>
<rect x="58" y="114" width="120" height="4" rx="2" fill="#C8C8C8"/>
```

When a specific piece of code IS the point (e.g., showing syntax highlighting for a kernel selector image), use `<tspan>` elements inside a `<text>` element for multi-color syntax:

```svg
<text x="58" y="86" font-family="'Consolas', 'SF Mono', 'Menlo', monospace" font-size="10.5">
  <tspan fill="#447099">x</tspan><tspan fill="#5A5A5A"> = </tspan><tspan fill="#098658">10</tspan>
</text>
```

## Toolbar Icons (Codicons)

All toolbar icons use codicon SVG paths scaled to fit inside a 16×16 coordinate space. See `references/codicons.md` for the full list of paths.

**Usage pattern** — scale icons to 16px at `translate(x, y)`:
```svg
<g transform="translate(10, 37)" fill="#5A5A5A">
  <path d="...codicon path..."/>
</g>
```

For smaller contexts (cell action bar at ~11px), scale down:
```svg
<g transform="translate(35, 68) scale(0.7)" fill="#5A5A5A">
  <path d="...codicon path..."/>
</g>
```

## Component Patterns

See `references/patterns.md` for copy-pasteable SVG snippets for every major component:

- Tab bar with active file tab
- Notebook toolbar (Run All, Clear All, + Code, + Markdown, Refresh, Python dropdown)
- Code cell (inactive / active / combined code+output)
- Cell action bar (floating toolbar above cell)
- Execution count `[n]`
- Vertical panel separator
- Variables pane header + rows
- Posit Assistant chat panel
- Context chip (file attachment pill)
- Bar chart output

## Tips

- **Blue is a focal point color** — don't use `#447099` everywhere. Reserve it for the one element that should draw the eye (active tab underline, active cell border, Python dropdown border, key highlights).
- **Keep the Variables pane and Posit Assistant panel visually distinct** — use the gray header (`#F4F4F4`) to anchor them.
- **Consistent cell padding**: line numbers at `text-anchor="end"` positioned 20px from cell left edge; code content 26px from cell left edge.
- **Separator lines** between code and output areas inside cells should be `#EEEEEE`, 1px.
- **Output areas** are always white (`fill="#FFFFFF"`), not gray — they represent rendered output, not a code editor.
- **Close (×) on active tab**: two crossing lines, not an SVG symbol — use two `<line>` elements.

## Reference Images

The four completed walkthrough SVGs in `src/vs/workbench/contrib/welcomeGettingStarted/common/media/` are the canonical style references:

- `notebook-hero-abstract.svg` — full-width notebook, cell action bar, large bar chart output
- `notebook-editor-abstract.svg` — editor + variables pane, Python dropdown focal point
- `notebook-ai-context-abstract.svg` — split Posit Assistant (left) / notebook (right)
- `kernel-selector-abstract.svg` — kernel dropdown menu open
