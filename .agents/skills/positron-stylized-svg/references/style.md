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
