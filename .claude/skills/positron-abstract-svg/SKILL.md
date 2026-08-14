---
name: positron-abstract-svg
disable-model-invocation: true
description: >
  Create or update abstract SVG illustrations for the Positron IDE -- for use in
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
Positron IDE for documentation, walkthroughs, onboarding, and feature previews.

It applies to **any part of the Positron IDE** -- editor, notebooks, data
explorer, console, plots, variables pane, terminal, AI assistant, and so on. The
bundled examples and component patterns happen to focus on notebooks (that is
what has been built so far), so treat them as a starting library rather than the
full scope: the constraints, palette, fonts, layering rules, and icon
conventions generalize to any surface. For a surface not yet covered, work from a
screenshot and compose new components from the same primitives in the same style.

## Critical Constraints

**These are static SVGs rendered as plain images (e.g. `<img src="...">`) in many different contexts** -- documentation sites, in-app walkthroughs, READMEs, etc. They cannot rely on the host page's styles or scripts. This means:

- **No external CSS / CSS variables** -- references like `var(--some-token)` will NOT resolve. All colors must be self-contained (hardcoded hex values, or an inline `<style>` block within the SVG itself).
- **No JavaScript** -- static SVG only.
- **Assume a light background by default** -- the palette and examples target a light context. Supporting both light and dark themes is a nice-to-have, not a requirement (see below); reach for it when the SVG will appear on surfaces of both kinds.
- **Sizing**: walkthrough images are commonly `width="520" height="260"`, but pick a size and aspect ratio that suits the surface you are depicting and where the image will appear.

For a light-only image, start with an opaque white background rect:
```svg
<rect width="520" height="260" fill="#FFFFFF"/>
```

To support light **and** dark, omit the opaque background and either use colors that read on both, or adapt with an inline `<style>` block inside the SVG (a `@media (prefers-color-scheme: dark)` rule honored when the SVG carries its own styles). Keep it simple and always preview on both backgrounds.

## Color Palette

These images exist to communicate complex UI simply. **Clarity comes first** -- a color that helps the eye parse the layout is worth using even if it isn't an exact Positron theme color. Matching the Positron theme is a nice-to-have, not a requirement; reach for whatever reads clearly at small sizes.

The palette below is a tested starting point. `#447099` is the Positron brand blue; reserve it for the focal point. Treat the grays as a coherent set rather than precise values to match.

| Color | Hex | Use |
|-------|-----|-----|
| Positron accent | `#3A78B1` | The theme's real accent, from `positron_light.json`: activity bar background, active tab underline (`tab.activeBorderTop`, `panelTitle.activeBorder`), buttons, badges, links, progress. Use it whenever you are depicting actual Positron chrome |
| Illustration blue | `#447099` | Focal-point highlights inside these images: active cell border, Python dropdown border, plot lines. Not present in any theme file -- don't reach for it to color chrome |
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

- **A screenshot of the actual Positron UI** being depicted -- this shows exact proportions, which elements are present, and what the focal point should be. If no screenshot is available, describe what you plan to show and confirm with the user.
- **Codicon names for any toolbar or action bar icons** -- e.g., `notebook-execute`, `debug-alt-small`, `run-above`. Use the ready-made paths in `references/codicons.md`; these are the curated, consistent set the existing walkthrough images already use. For an icon not listed there, copy the `d=` from `node_modules/@vscode/codicons/src/icons/<name>.svg`, then simplify it to match the flat style of the existing set (upstream codicons have evolved, so a fresh pull may not match visually).
- **File type icons** -- Positron uses the [Seti UI](https://github.com/jesseweed/seti-ui) file icon theme. It ships only as a font (`extensions/theme-seti/icons/seti.woff`), so there is no per-file SVG in the repo. Don't hand-draw one and don't fetch from the seti-ui repo over the network -- pull the exact glyph out of the font we ship. See "Extracting a Seti file icon" below.

## Workflow

1. **Gather input** -- screenshot of the UI, icon names, file types (see above).
2. **Plan the layout** -- decide what panels/components to show and their proportions.
3. **Sketch in SVG** -- write the SVG, starting with background elements, then building up layers.
4. **Preview** -- always render a preview before saving to file; this catches layout issues early. In **Claude Desktop**, use the `show_widget` tool -- it renders the SVG inline and is the fastest way to iterate. In other environments (CLI, etc.), `show_widget` is unavailable, so preview by writing the SVG to a temp file and opening it in a browser or image viewer.
5. **Iterate** -- adjust based on the preview, re-render, repeat until it looks right.
6. **Save** -- write the final SVG to the correct path in the repository. If you previewed via a renderer (e.g. `show_widget` in Claude Desktop), strip any cruft it injected before saving: per-element `style="fill:rgb(...);..."` attributes (the `fill="#hex"` attribute already carries the color) and any `Anthropic Sans` / renderer-specific font names. Ship clean SVG with only the font stacks listed below.

## SVG Layering (Z-order)

SVG renders elements in document order -- later elements appear on top. The general rule: draw containers before their contents, and floating/overlay elements last. For example:

- Draw a container's border and background **before** the content inside it (a cell, panel, dialog, etc.).
- Draw **floating toolbars and overlays after** their parent so they sit on top (e.g. a cell action bar).
- Draw **separator/divider lines** early so later content overlaps them cleanly.

## Fonts

- **UI labels, tab names, panel headers**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Code and line numbers**: `'Consolas', 'SF Mono', 'Menlo', monospace`

## Code Representation

Never write real readable text (code, labels, descriptions) in these illustrations unless the content is the focal point of the image. Use placeholder gray rects for any body text instead:

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

All toolbar icons use codicon SVG paths scaled to fit inside a 16x16 coordinate space. See `references/codicons.md` for the curated, ready-to-use icon paths.

**Usage pattern** -- scale icons to 16px at `translate(x, y)`:
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

### The activity bar always gets real icons

The activity bar is the strip down the left edge of Positron (VS Code calls it
the activity bar; it is the thing that switches which primary side bar view you
see). **Draw its icons as the actual codicons Positron shows there -- Explorer,
Search, Source Control, Run and Debug, Extensions -- in that order.** Never fill
it with abstract squares, circles, or alternating shapes.

A row of nameless blobs is the one place in these images where abstraction costs
more than it saves. Everywhere else a gray rect clearly stands in for text the
reader is meant to skip. In the activity bar it just reads as noise, and it
throws away the fastest cue that says "this is an IDE." Real glyphs also anchor
the reader: they can find the same icons in their own window.

The rule holds even at small sizes. Explorer, Search, Source Control, and
Extensions all stay readable down to about 9px; `debug-alt` is the first to turn
to mush, so drop it before the others if you are showing fewer icons. Showing
four of the five is fine -- a partial, honest activity bar beats a full row of
shapes.

**The bar is blue.** In the default light theme it is `#3A78B1` with white icons
and no border, not a gray strip. Take the values from
`extensions/theme-defaults/themes/positron_light.json` rather than guessing; the
full table is in `references/patterns.md`, "Activity Bar". This is the one place
a large block of saturated color is right even though blue is otherwise a
focal-point-only color -- it is what the user sees down the left edge of their
own window, so it is the fastest thing to recognize.

Ready-to-use paths: `references/codicons.md`, "Activity Bar Icons". Full
snippet with sizing: `references/patterns.md`, "Activity Bar".

### Extracting a Seti file icon

Seti ships as a font, but you can read a glyph's outline straight out of it and
emit an SVG path. This gets you the real icon Positron renders, with no network
call and no guessing.

Two lookups first, both in `extensions/theme-seti/icons/vs-seti-icon-theme.json`:

- `fileExtensions` / `fileNames` maps an extension to an icon definition name.
  For an untitled or unknown-type document, the top-level `file` key points at
  `_default`.
- `iconDefinitions[<name>]` gives you `fontCharacter` (the code point, e.g.
  `\E023`) and `fontColor`. Definitions ending in `_light` are the light-theme
  variants -- these images are light by default, so use those.

Then run this against the code point (`fontTools` is already available; run it
from the repo root):

```python
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

CODEPOINT = 0xE023  # from fontCharacter

f = TTFont('extensions/theme-seti/icons/seti.woff')
gs = f.getGlyphSet()
g = gs[f.getBestCmap()[CODEPOINT]]
bp = BoundsPen(gs); g.draw(bp)
xmin, ymin, xmax, ymax = bp.bounds
w, h = xmax - xmin, ymax - ymin
s = 16.0 / max(w, h)                      # fit the long side to a 16x16 box
tx = (16 - w * s) / 2 - xmin * s
ty = (16 - h * s) / 2 + ymax * s          # +ymax because the Y axis flips
pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}")
g.draw(TransformPen(pen, Transform(s, 0, 0, -s, tx, ty)))
print(pen.getCommands())
```

Fonts draw Y upward and SVG draws it downward, which is what the negative `s` in
the transform is for. Scaling by the long side keeps the glyph's real proportions
instead of squashing it into a square. The result drops into the usual 16x16
wrapper, so `scale(0.5)` gives an 8px tab icon.

Check the shape before you trust your mental image of it: Seti's `_default` is
four stacked horizontal bars, not the folded-corner page most people picture.

**Watch the color.** Seti's light `_default` is `#bfc2c1`, near-identical in value
to the `#C8C8C8` placeholder rects. A bar-shaped glyph in that gray stops reading
as an icon and starts reading as more placeholder text. Darken to `#8A8A8A`, which
separates it from the placeholders without letting it compete with the tab's
close (x). Fidelity to the theme color loses to legibility here.

## Component Patterns

See `references/patterns.md` for copy-pasteable SVG snippets. The current set is notebook-focused (it covers what has been built so far). For other Positron surfaces, reuse the general primitives below -- tab bars, panels, toolbars, icons, placeholder text, separators -- and compose new components in the same style. Available snippets:

- Activity bar (primary side bar icon strip)
- Tab bar with active file tab
- Notebook toolbar (Run All, Clear All, + Code, + Markdown, Refresh, Python dropdown)
- Code cell (inactive / active / combined code+output)
- Cell action bar (floating toolbar above cell)
- Execution count `[n]`
- Vertical panel separator
- Secondary side bar title bar (auxiliary bar tabs + right-pinned actions)
- View section header with collapse chevron
- Variables pane header + rows
- Posit Assistant chat panel
- Context chip (file attachment pill)
- Bar chart output

## Tips

General (apply to any surface):

- **Blue is a focal-point color** -- don't use `#447099` everywhere. Reserve it for the one element that should draw the eye (the active/selected item, a key highlight).
- **An active tab is marked by its underline, not its label color.** Positron overrides `tab.activeBorderTop` and `panelTitle.activeBorder` to `#3A78B1`, but leaves the foreground at the `#3B3B3B` it inherits from `light_modern.json`. So the underline goes blue and the label stays the same color as every other header. Colouring the label too looks plausible and is wrong.
- **Check the theme before you invent a chrome color.** `extensions/theme-defaults/themes/positron_light.json` is short, and it is the answer for activity bar, tab borders, buttons, and badges. It `include`s `light_modern.json`, so a key absent from the Positron file is inherited, not unset -- look there before concluding Positron has no opinion.
- **Anchor distinct regions with a gray header** (`#F4F4F4`) -- it keeps panels (Variables, Posit Assistant, any sidebar) visually separate.
- **Build glyphs from primitives, not font symbols** -- e.g. a close (x) is two crossing `<line>` elements, not an SVG symbol.
- **Real icons in the activity bar, always** -- Explorer, Search, Source Control, and so on, never abstract squares or circles. See "The activity bar always gets real icons" above.
- **Prefer one strong icon over a crowded toolbar** -- a toolbar abstracted down to its single most recognizable control (the Run button in an editor action bar) reads better than a row of half-legible glyphs and placeholder pills. Small round dots (an ellipsis drawn as three `<circle>`s) are the usual offender: they do not survive scaling, so use the `ellipsis` codicon path or drop the control.
- **In a title or tab bar, nothing floats in the middle** -- tabs group tight against the left edge, title actions pin to the right edge (~8px inset), and whatever gap is left sits between the two groups. A placeholder stranded mid-bar belongs to neither group and reads as a mistake, because in the real UI that space is flex. This is the single most common way these bars go wrong.
- **Give stacked view sections a collapse chevron** -- a `chevron-down` to the left of a section header (Variables, Plots) is what makes a side bar read as collapsible panes rather than flat colored strips. Costs ~7px and one path.
- **Output/content areas are white** (`fill="#FFFFFF"`), reserved for rendered results; gray backgrounds read as editors/inputs.
- **Use the palette's grays; don't invent one.** Placeholders are `#C8C8C8`, output and axis ticks `#D0D0D0`. Reaching for a lighter custom gray to calm a busy image is the wrong lever -- it makes that image the odd one out across the set, and it barely helps. If an image feels noisy, delete elements and collapse the grays you already have down to these two. An image that has drifted to four or five near-identical grays reads as if the differences mean something, which is itself most of the noise.
- **Nothing placeholder should be as dark as an icon.** `#5A5A5A` is for icons. A column of placeholder rects at icon darkness (a variables pane's name column, say) becomes the heaviest thing in the image while carrying no information.

Notebook-specific (examples of applying the above):

- **Consistent cell padding**: line numbers at `text-anchor="end"` positioned 20px from the cell's left edge; code content 26px from the left edge.
- **Code/output separator lines** inside a cell: `#EEEEEE`, 1px.

## Reference Images

The canonical style references live in `references/examples/` next to this skill. They were produced with this skill and are the ground truth for palette, spacing, and conventions -- open them and match their style:

- `notebook-hero-abstract.svg` -- full-width notebook, floating cell action bar, large bar chart output
- `notebook-editor-abstract.svg` -- editor + variables pane, Python dropdown focal point
- `notebook-ai-context-abstract.svg` -- split Posit Assistant / notebook view
- `kernel-selector-abstract.svg` -- kernel dropdown menu open (note the 400x210 canvas)

**Caveat:** some `*-abstract.svg` files in the repo's walkthrough media folder (`src/vs/workbench/contrib/welcomeGettingStarted/common/media/`, e.g. `data-explorer-abstract.svg`) were NOT created with this skill. Do not treat those as style references -- their palette and conventions differ. Use the bundled `references/examples/` set instead.
