# Positron UI Evidence Guide

Use this guide when visual accuracy depends on where a surface lives, which
controls it contains, or which icon Positron actually renders.

## Evidence hierarchy

User intent is above the evidence hierarchy. Explicit requests to simplify,
restyle, rearrange, explore a new visual direction, or intentionally depart
from current Positron behavior must be honored. Do not reinterpret a deliberate
deviation as an accuracy problem.

Prefer evidence that describes the current product state over an older
illustration. A screenshot is strongest for proportions and visible state.
Source is strongest for component ownership, order, icon identity, and theme
tokens. Committed walkthrough SVGs have been iterated on and passed review, so
they are the canonical examples for illustration style, abstraction density,
spacing, and finish. They may still represent an older product state.

When sources disagree:

- Follow the user's explicit direction before all reference material.
- Follow the user's screenshot for the state being illustrated.
- Follow current source for ownership, ordering, and icon identity.
- Follow current theme files for chrome colors.
- Follow reviewed walkthrough SVGs for abstraction, density, and finish.
- Mention a consequential unresolved inference to the user.

Existing SVGs are style references, not product specifications. If the user
wants consistency with the established set, borrow their palette, density,
stroke language, typography, and abstraction patterns. If the user requests a
new direction, use only the parts that remain compatible with that request.
Never copy an existing scene structure without checking it against current
source or the requested state.

## Where to inspect

### Workbench regions and panes

Start with:

```text
src/vs/workbench/services/positronLayout/browser/layouts/
```

The default stacked data-science layout is described by
`positronFourPaneDsLayout.ts`. It places Explorer in the primary side bar,
Console and Terminal in the panel, and Session—with Variables and Plots—in the
auxiliary bar.

Then inspect the relevant `*.contribution.ts` for view-container location,
titles, ordering, and menu registrations. Do not place a pane based only on its
name.

### Theme colors

Inspect:

```text
extensions/theme-defaults/themes/positron_light.json
extensions/theme-defaults/themes/positron_dark.json
extensions/theme-defaults/themes/light_modern.json
extensions/theme-defaults/themes/dark_modern.json
```

Positron theme files include a base theme. If a token is absent, inspect the
included theme rather than treating the value as undefined.

Important light-theme landmarks:

- `activityBar.background`: `#3A78B1`
- `activityBar.foreground`: `#FFFFFF`
- `activityBar.inactiveForeground`: translucent white
- `tab.activeBorderTop`: `#3A78B1`
- `panelTitle.activeBorder`: `#3A78B1`

### Proportions

Reviewed examples don't agree on absolute pixel dimensions for the same
region: one draws an 18px-wide activity bar, another omits the activity bar
entirely. Copying a number from the nearest existing SVG is not the same as
matching the app -- when a region's relative size is part of what the user
asked to get right, compute the ratio from source instead.

- Activity bar width and per-item height: `ACTIVITYBAR_WIDTH` and
  `ACTION_HEIGHT` in `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts`
  (48 and 48 by default; also `COMPACT_*` and `FLOATING_*` variants).
- Default Primary Side Bar width: `SIDEBAR_SIZE`'s default in
  `src/vs/workbench/browser/layout.ts`, computed as
  `Math.min(300, mainContainerDimension.width / 4)` -- not a fixed constant,
  so pick a plausible container width before deriving a ratio from it.
- View/part title bar height: `.part > .title` in
  `src/vs/workbench/browser/media/part.css` (35px). A view's own secondary
  section header (e.g. "Changes" under "Source Control") is shorter --
  see `.pane-header` in `src/vs/workbench/browser/parts/views/media/views.css`
  (22px).

Convert whichever pair of regions matters for the scene into a ratio (for
example activity-bar-width : sidebar-width) and apply that ratio to the
chosen canvas, rather than reusing one reviewed example's raw numbers. Render
and eyeball the result afterward -- a mechanically correct ratio can still
look wrong at the compact sizes these illustrations use.

### Actions and icons

Search for labels, command IDs, `Codicon.<name>`, `ThemeIcon`, menu IDs, or CSS
classes near the component implementation. Verify:

- icon name;
- viewBox dimensions;
- direction;
- enabled/selected state;
- left/right grouping;
- whether the control is normally visible or contextual.

Extract the shipped path with `scripts/extract_icon.py`. Do not copy a random
web version: codicons evolve and may not match this checkout.

### File icons

Seti mappings live in:

```text
extensions/theme-seti/icons/vs-seti-icon-theme.json
extensions/theme-seti/icons/seti.woff
```

Use the extraction script with a filename or extension. Preserve the glyph's
aspect ratio. It is acceptable to darken an extremely pale theme glyph slightly
when its original value is indistinguishable from placeholder bars.

### Reviewed illustrations

Reviewed Positron walkthrough images are committed in:

```text
src/vs/workbench/contrib/welcomeGettingStarted/common/media/*abstract.svg
```

Treat these as the canonical example set. Inspect the examples closest to the
requested surface and at least one broader workbench example, such as
`positron-panes-abstract.svg`, before drawing. Reuse proven spacing, palette,
icon scale, border treatment, and abstraction patterns where applicable.

Their absolute pixel dimensions are not a ratio guarantee across the set --
see Proportions above before copying a region's width or height from one of
these files.

Do not assume every example depicts the latest product state. Verify pane
ownership, control identity, and theme tokens against current source when those
details matter. If an older example conflicts with current source, preserve its
style while updating the product structure.

Useful reviewed examples include:

- `positron-panes-abstract.svg`: full workbench hierarchy and four-pane layout.
- `positron-git-abstract.svg`: source-control surface and selected-state focus.
- `positron-extensions-abstract.svg`: activity bar and primary side bar.
- `positron-keybindings-abstract.svg`: editor-like list content.
- `notebook-hero-abstract.svg`: notebook cell and output composition.
- `notebook-editor-abstract.svg`: notebook with Variables.
- `notebook-ai-context-abstract.svg`: Posit Assistant and editor split.
- `kernel-selector-abstract.svg`: focused dropdown and menu state.

## Screenshot comparison

Translate screenshot evidence into relationships rather than tracing pixels:

- Which region is left/right/above/below?
- Which boundary is strongest?
- What is selected, expanded, active, or floating?
- Which controls make the surface recognizable?
- Where does flexible empty space occur?
- Which content can become placeholders without losing meaning?

Preserve these relationships even when the illustration uses different
proportions from the screenshot.

## Region ownership invariant

Composition never overrides product ownership. Distinctive content such as a
plot, data grid, output, Variables table, terminal prompt, or chat response must
have evidence for the region that contains it.

For each distinctive object, answer:

1. Which workbench part or component owns it?
2. Is it inline content, an editor, a panel view, a side-bar view, or an
   overlay?
3. What source, screenshot, or reviewed example establishes that relationship?

If those questions cannot be answered, omit the object or replace the entire
area with neutral structure. Do not add a chart, table, or toolbar simply to
fill empty space.
