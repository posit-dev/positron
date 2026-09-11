---
name: positron-stylized-svg
description: Create or revise minimal, stylized SVG illustrations that accurately represent the Positron UI for documentation, tutorials, walkthroughs, onboarding, and feature previews. Use when an SVG should resemble Positron or match its walkthrough illustration style; do not use for diagrams that are not representations of the product UI.
---

# Positron Stylized SVG

Create a recognizable visual landmark, not a miniature screenshot. Preserve the
real UI's hierarchy, placement, distinctive controls, icon direction, and
selected state while removing detail that does not help the feature being
explained.

## Evidence before drawing

The user's requested direction, constraints, and intentional deviations always
win. Evidence fills in unspecified product details; it must not pull the work
back toward an older image or the current UI when the user explicitly wants a
different treatment.

For details the user has not intentionally changed, accuracy outranks
convention. Build a small scene specification from the best available evidence,
in this order:

1. A current screenshot supplied by the user.
2. Positron layout descriptors, contributions, menus, component source, and
   theme files in this checkout.
3. Reviewed SVGs committed under
   `src/vs/workbench/contrib/welcomeGettingStarted/common/media/`.
4. The visual conventions in [references/style.md](references/style.md).
5. Clearly identified inference.

Read [references/evidence.md](references/evidence.md) when the scene includes
workbench panes, unfamiliar controls, file icons, or any detail whose location
or glyph is uncertain. Do not ask the user for routine facts that can be
verified in the checkout. Ask for a screenshot or clarification only when
different plausible states would materially change the illustration.

Before writing SVG, record a concise scene specification in working notes:

- delivery dimensions and expected display width;
- ordered regions and approximate proportions;
- the single focal feature;
- each distinctive object's parent region and the evidence for that ownership;
- exact labels that must remain readable;
- exact icons and selected/expanded states;
- details intentionally replaced by placeholders or omitted;
- evidence used for uncertain details.

A screenshot is preferred when the illustration must match a particular
workspace state, transient UI, or recent design. It is not routinely required.
When no screenshot is supplied, derive the scene from the checkout and state
material uncertainty. Never invent product content merely to balance the
composition.

## Choose the canvas

Inspect the destination before choosing dimensions. If the destination does not
impose a size, use these defaults:

- `520×260` for a full workbench, editor-plus-pane, or ordinary landscape
  walkthrough illustration. This is the standard default for the reviewed
  Positron abstract set.
- Approximately `400×210` for a tightly focused control, dropdown, or compact
  interaction where a full workbench would create empty filler.
- Choose another canvas only when the destination, neighboring asset set, or
  content hierarchy clearly calls for it. Preserve a simple aspect ratio and
  explain the choice in the scene specification.

Canvas size is not display size. Positron's built-in markdown walkthrough
images are commonly displayed at 400px wide, so render and inspect the SVG at
400px even when its coordinate canvas is 520px wide. Read the sizing section in
[references/style.md](references/style.md) before using a non-default canvas.

## Drawing contract

- Produce static, self-contained SVG: no JavaScript, external CSS, remote
  resources, unresolved CSS variables, or renderer-specific fonts.
- Make `width`, `height`, and `viewBox` describe the same canvas unless the user
  explicitly needs different intrinsic and coordinate dimensions.
- Use real codicons for recognizable actions and all activity-bar icons. Never
  substitute arbitrary geometric blobs for navigation or action icons.
- Use readable text only for landmarks and content essential to the lesson.
  Represent incidental text and code with quiet placeholder bars.
- Every distinctive object must belong to a verified product region. Record the
  owner in the scene specification and group it with
  `data-owner="<region>"` where practical. If ownership cannot be verified,
  omit the object rather than placing it where it looks compositionally useful.
- Mark each incidental placeholder bar with `data-role="placeholder"` so the
  validator can measure density. Aim for 2–5 bars per visible content region
  and no more than 28 on a typical 520×260 canvas. Empty space is preferable to
  decorative placeholder copy.
- Keep tabs/actions anchored to their real edges and groups. Empty flex space
  belongs between groups, not around controls.
- Preserve icon orientation and state. A generic icon with the wrong direction
  is less accurate than omitting the control.
- Use `#3A78B1` for actual Positron chrome and selected-state indicators.
  Reserve `#447099` for illustration content such as plot marks or an
  intentionally emphasized object.
- Use one focal emphasis. Large saturated regions are allowed only where they
  exist in Positron, notably the activity bar.
- Draw backgrounds and containers first, their content next, then floating
  controls and overlays. Keep strokes inside the canvas or account for their
  half-pixel extent.

Read [references/style.md](references/style.md) for the palette, typography,
abstraction rules, and canonical component behavior. For visual execution,
inspect the relevant committed `*abstract.svg` files as concrete reviewed
examples. Existing SVGs constrain style only to the extent the user asks to
match the established set. Never let them override user intent, current product
source, or a supplied screenshot. Reuse their structure only after verifying
that it still represents the requested UI.

## Icon extraction

Prefer extracting the icon shipped by this checkout:

```bash
python3 <skill-dir>/scripts/extract_icon.py codicon <icon-name>
python3 <skill-dir>/scripts/extract_icon.py seti --extension <extension>
python3 <skill-dir>/scripts/extract_icon.py seti --filename <filename>
```

The script emits SVG-ready paths and source metadata. Search source for the
action's codicon name before choosing a visually similar icon.

## Required QA

Iterate from rendered output, not source inspection alone.

1. Render at the intended display width, commonly 400px for walkthroughs.
2. Render at 2x or greater and inspect seams, clipping, optical alignment,
   stroke weight, icon orientation, and overlay z-order. Check every header or
   title bar where readable text sits next to trailing action icons: a title's
   rendered width depends on font size, letter spacing, and character count, so
   confirm from the render that it does not run into the icons rather than
   trusting a computed x position.
3. Compare the render against the scene specification and source evidence.
4. Perform an ownership pass: for every plot, table, output, menu, toolbar, and
   pane, point to evidence for its parent region. Remove unsupported objects.
5. Remove detail that competes with the focal feature and collapse repetitive
   placeholders.
6. Validate the final file:

```bash
python3 <skill-dir>/scripts/validate_svg.py path/to/image.svg
```

Treat validator errors as blockers. Review warnings deliberately; do not silence
them by weakening the validator. If `rsvg-convert` is available, use it for a
portable final render:

```bash
rsvg-convert -w 400 path/to/image.svg -o /tmp/positron-svg-400.png
rsvg-convert -z 4 path/to/image.svg -o /tmp/positron-svg-4x.png
```

Deliver the SVG only after opening at least one rendered preview. Briefly state
which product evidence determined the layout or controls and identify any
remaining inference.
