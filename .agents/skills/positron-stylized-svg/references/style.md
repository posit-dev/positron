# Positron Stylized SVG Language

The desired feeling is calm, focused, consistent, and immediately recognizable
as Positron. Simplify density while preserving product structure.

## Canvas sizing

VS Code walkthrough media is responsive rather than built around one universal
SVG canvas. The host may display walkthrough media at different sizes depending
on the available editor space. Positron's reviewed abstract illustrations,
however, establish a useful local convention.

### Defaults

| Scene | Default canvas | Typical use |
|---|---:|---|
| Full workbench or multiple regions | `520×260` | Editor with side bars, panel, notebook plus Variables |
| Ordinary feature walkthrough | `520×260` | Extensions, Git, keybindings, one primary view |
| Focused control or open menu | `400×210` | Session selector, dropdown, compact transient state |
| Destination-defined asset | Match destination | Existing series, documentation slot, supplied template |

Use `520×260` when the user gives no dimensions and the scene fits comfortably
at roughly 2:1. Do not add unrelated panes, charts, rows, or placeholder bars
merely to fill that canvas. If the useful scene is intrinsically smaller,
choose the compact canvas.

Choose a taller or wider ratio only when the content requires it—for example, a
tall picker, vertical onboarding sequence, or a destination with a known aspect
ratio. Prefer cropping scope over stretching UI regions into implausible
proportions.

### Canvas versus rendered size

For SVG, coordinate dimensions primarily provide a stable drawing system; they
do not need raster-style HiDPI multiplication. Keep `width`, `height`, and
`viewBox` consistent:

```svg
<svg width="520" height="260" viewBox="0 0 520 260" ...>
```

The reviewed Positron walkthroughs are commonly embedded at 400px wide. Always
preview at the actual delivery width because icons, placeholder bars, and
strokes that look balanced at high zoom may become noisy or disappear after
scaling.

If the destination is unknown, record these assumptions in the scene
specification:

- canvas: `520×260`;
- expected display width: `400px`;
- background: light;
- aspect ratio: `2:1`.

## Palette

Use this compact palette unless source evidence or the requested theme requires
another value.

| Role | Value |
|---|---|
| Positron chrome accent | `#3A78B1` |
| Illustration content accent | `#447099` |
| Running session | `#3DAA6E` |
| Primary icon | `#5A5A5A` |
| Secondary icon/text | `#8A8A8A` |
| Line numbers | `#8DA5B8` |
| Placeholder content | `#C8C8C8` |
| Secondary placeholder/axis | `#D0D0D0` |
| Fine separator | `#EEEEEE` |
| Structural separator | `#E0E0E0` |
| Selected row | `#EEF3F8` |
| Panel header | `#F4F4F4` |
| Tab strip | `#F2F2F2` |
| Toolbar/editor input | `#FAFAFA` / `#F8F8F8` |
| Output/content | `#FFFFFF` |
| Header text | `#3E4246` |
| Body text | `#333333` |

Do not create several nearly identical grays to reduce visual noise. Reduce the
number of elements instead. Placeholder content must remain lighter than icons.
Reviewed examples may contain additional feature-content colors (for example,
plot series colors). Reuse those only when the depicted content calls for them;
do not promote them to general chrome or placeholder colors.

## Type

- UI: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Code: `'Consolas', 'SF Mono', 'Menlo', monospace`

Text `y` is a baseline, not a visual center. Render and optically align labels
with neighboring icons and bars.

### Icon and label alignment

For a single-line label beside an icon, make alignment machine-checkable:

```svg
<g data-role="icon-label-pair" data-name="release-notes">
  <svg data-role="aligned-icon"
       x="364" y="30" width="12" height="12" viewBox="0 0 16 16">
    <!-- extracted icon paths -->
  </svg>
  <text data-role="aligned-label"
        x="380" y="36" dominant-baseline="middle">Release Notes</text>
</g>
```

The icon and label must be direct children of the pair and use the same local
coordinate system. Do not put a `transform` on either aligned child. The
label's `y` is its center because it uses `dominant-baseline="middle"`; it must
equal `icon y + icon height / 2`. The default tolerance is 0.25 canvas units.
Set `data-align-tolerance` on the pair only when a deliberate optical adjustment
needs more room, and keep the value as small as the rendered result permits.

Generate the explicit icon box directly when extracting an icon:

```bash
python3 <skill-dir>/scripts/extract_icon.py \
  codicon megaphone --aligned-box 364 36 12
```

This contract is for one icon next to one line of text. Do not force a
multi-line brand lockup, icon-only button, or unrelated trailing action into an
icon-label pair. Those still require rendered optical inspection.

### Button bounds

A button that hugs its own label (most Positron toolbar buttons do, via
`flex: 0 0 auto` and a fixed padding) is easy to hand-size wrong: pick a
plausible-looking width and the label can run past the border once it renders
in the SVG's actual font, even though a quick crop at a different render tool
looked fine. Make the check machine-checkable the same way alignment is, by
adding a `data-role="button-bounds"` rect as a direct child of the pair:

```svg
<g data-role="icon-label-pair" data-name="release-notes">
  <rect data-role="button-bounds" x="312" y="20" width="113" height="24"
        rx="4" fill="#FFFFFF" stroke="#D0D0D0"/>
  <svg data-role="aligned-icon" x="321" y="25" width="14" height="14"
       viewBox="0 0 16 16"><!-- icon paths --></svg>
  <text data-role="aligned-label" x="341" y="32" dominant-baseline="middle"
        font-size="12">Release Notes</text>
</g>
```

The validator measures the label with the font named in the SVG's own
`font-family` (walking up to whichever ancestor sets it, the way inheritance
works in a browser), so the check reflects what the SVG will actually render
as, not one font hardcoded into the tool. It flags a label whose measured
width would run past the rect's right edge, start left of the rect's left
edge, or sit left of an icon that starts before the rect does. Set
`data-min-padding` on the pair only to relax the default 1px tolerance for a
deliberately tight design; do not raise it to silence a real overflow.

This is opt-in: a pair with no `button-bounds` rect is not checked. Add one to
every pair that represents a real clickable button; skip it for a label that
is not inside a sized container (a plain toolbar label with no visible box).

If the check reports it cannot resolve a font, it skips rather than blocking:
either Pillow is not installed, or none of the font-family's fonts exist on
this machine. Treat that warning as "unverified," not "passing" -- inspect a
render as usual rather than trusting the gap it left unchecked.

Use real text for stable landmarks such as `EXPLORER`, `CONSOLE`, `SESSION`,
`VARIABLES`, `PLOTS`, a focal menu command, or a filename central to the lesson.
Use rounded rectangles for incidental filenames, body copy, table values, and
code.

### Placeholder density

Placeholder bars communicate texture, not prose. Use the minimum number needed
to identify the kind of region:

- sparse list or tree: 2–4 rows;
- code editor or notebook cell: 3–5 lines;
- table: one focal row plus 2–3 abstract rows;
- chat response: 2–4 lines;
- inactive or background region: fewer than the focal region.

Avoid filling every available row. Vary widths deliberately, keep indentation
consistent with the represented structure, and mark each bar
`data-role="placeholder"`. On a 520×260 canvas, 28 bars is a ceiling rather than
a target.

## Product landmarks

### Activity bar

The default light activity bar is blue with white real icons and no visible
border. Explorer, Search, Source Control, Run and Debug, and Extensions are
ordered vertically. Showing fewer authentic icons is better than filling the
bar with generic shapes.

### Tabs and title actions

Tabs form a tight group at the leading edge. Title actions form a tight group
at the trailing edge. Flexible space sits between those groups.

The same leading-title / trailing-actions pattern applies to view panel
headers (Source Control, Variables, and similar), not only editor tabs. These
panels are typically much narrower than the editor, so a title and its actions
can easily collide. Real VS Code truncates the title rather than letting it
overlap the actions; do the same by shortening the title text or its font size
until a render confirms clearance, instead of picking a fixed x offset by eye.

An active editor tab uses the Positron accent on its top border. An active panel
or auxiliary-bar tab uses the accent on its lower indicator. Do not also turn
the label blue unless current source or a screenshot shows that state.

### Side bars and stacked views

Give each collapsible view section a real chevron. The auxiliary bar's Session
container contains Variables and Plots in the default stacked layout. Do not
mislabel Help, Connections, Viewer, or History as panel tabs.

### Editors and notebooks

Editor/input areas may be lightly gray; rendered output stays white. Maintain
consistent gutters and content indentation. Notebook execution controls and
session selectors use real codicons and state indicators.

### Overlays

Menus, dropdowns, cell action bars, and dialogs render after their parent
surface. Their alignment and attachment point are more important than copying
every menu item.

## Contrast and density

Use one focal treatment:

- selected border or indicator;
- open menu;
- active control;
- highlighted row;
- plot or result content.

Do not combine several equally strong treatments. At final display size, icons
should remain recognizable, structural boundaries should be visible, and
placeholder content should recede.

## Canvas and strokes

Keep `width`, `height`, and `viewBox` consistent. Remember that a 1px stroke on
an integer coordinate extends half a pixel on each side. Use half-pixel
coordinates when a crisp seam requires them, and inspect the render at high
zoom.

Prefer a simple rectangular canvas for walkthrough images. Rounded outer
corners are appropriate only when the destination or neighboring assets use
them.
