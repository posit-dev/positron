# Positron Codicon SVG Paths

These are the **curated icon paths used across the existing Positron walkthrough SVGs** -- a frozen, internally-consistent set. Use them as-is so new images match the canonical look. All paths use a 16x16 coordinate space. Use `transform="translate(x, y)"` to position and `scale(n)` to resize.

> Need an icon that isn't here? Grab it from `node_modules/@vscode/codicons/src/icons/<name>.svg` and copy its `d=`. Be aware upstream codicons have been redesigned over time, so a freshly pulled icon may have slightly different geometry than this set -- simplify it to match the flat style of the icons below rather than mixing visual eras.

## Toolbar-scale usage (full 16px)

```svg
<g transform="translate(X, Y)" fill="#5A5A5A">
  <path d="..."/>
</g>
```

## Action-bar-scale usage (~11px, centered in a 16px-tall bar at y=BAR_TOP)

```svg
<!-- scale(0.7) -> 11.2px icon; to center in 16px bar: translate y = BAR_TOP + 2.4 -->
<g transform="translate(X, BAR_TOP_PLUS_2) scale(0.7)" fill="#5A5A5A">
  <path d="..."/>
</g>
```

---

## Run All (notebook-execute-all)

Two overlapping play triangles -- use both paths together.

```svg
<g transform="translate(X, Y)" fill="#5A5A5A">
  <path d="M2.78 2L2 2.41v12l.78.42 9-6V8l-9-6zM3 13.48V3.35l7.6 5.07L3 13.48z"/>
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M6 14.683l8.78-5.853V8L6 2.147V3.35l7.6 5.07L6 13.48v1.203z"/>
</g>
```

## Notebook Execute (single play -- notebook-execute)

Single play triangle, used in cell action bars.

```svg
<path d="M3.78 2L3 2.41v12l.78.42 9-6V8l-9-6zM4 13.48V3.35l7.6 5.07L4 13.48z"/>
```

## Clear All

```svg
<path d="M10 12.6l.7.7 1.6-1.6 1.6 1.6.8-.7L13 11l1.7-1.6-.8-.8-1.6 1.7-1.6-1.7-.7.8 1.6 1.6-1.6 1.6zM1 4h14V3H1v1zm0 3h14V6H1v1zm8 2.5V9H1v1h8v-.5zM9 13v-1H1v1h8z"/>
```

## Add (plus -- used for + Code and + Markdown buttons)

Scale to 0.6875 when rendering at toolbar size alongside text labels.

```svg
<path d="M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z"/>
```

## Refresh

```svg
<path fill-rule="evenodd" clip-rule="evenodd"
      d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/>
```

## Chevron Down (used in Python session dropdown)

Scale to 0.625 when rendering small.

```svg
<path fill-rule="evenodd" clip-rule="evenodd"
      d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/>
```

## Trash

```svg
<path fill-rule="evenodd" clip-rule="evenodd"
      d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
```

## Debug Alt Small (debug-alt-small)

Two paths -- use both together.

```svg
<g transform="translate(X, Y)" fill="#5A5A5A">
  <path d="M7.293 9.006l-.88.88A2.484 2.484 0 0 0 4 8a2.488 2.488 0 0 0-2.413 1.886l-.88-.88L0 9.712l1.147 1.146-.147.146v1H0v.999h1v.053c.051.326.143.643.273.946L0 15.294.707 16l1.1-1.099A2.873 2.873 0 0 0 4 16a2.875 2.875 0 0 0 2.193-1.099L7.293 16 8 15.294l-1.273-1.292A3.92 3.92 0 0 0 7 13.036v-.067h1v-.965H7v-1l-.147-.146L8 9.712l-.707-.706zM4 9.006a1.5 1.5 0 0 1 1.5 1.499h-3A1.498 1.498 0 0 1 4 9.006zm2 3.997A2.217 2.217 0 0 1 4 15a2.22 2.22 0 0 1-2-1.998v-1.499h4v1.499z"/>
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M5 2.41L5.78 2l9 6v.83L9 12.683v-1.2l4.6-3.063L6 3.35V7H5V2.41z"/>
</g>
```

## Run Above (run-above)

```svg
<path d="M1.77 1.01L1 1.42v12l.78.42 9-6v-.83l-9.01-6zM2 12.49V2.36l7.6 5.07L2 12.49zM12.15 8h.71l2.5 2.5-.71.71L13 9.56V15h-1V9.55l-1.65 1.65-.7-.7 2.5-2.5z"/>
```

## Ellipsis

```svg
<path d="M4 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
```

## Send (used in AI chat input box)

```svg
<path d="M1.17683 1.11898C1.32953 0.989634 1.54464 0.963786 1.72363 1.05328L14.7236 7.55328C14.893 7.63797 15 7.8111 15 8.00049C15 8.18987 14.893 8.36301 14.7236 8.4477L1.72363 14.9477C1.54464 15.0372 1.32953 15.0113 1.17683 14.882C1.02414 14.7526 0.96328 14.5447 1.02213 14.3534L2.97688 8.00049L1.02213 1.64754C0.96328 1.45627 1.02414 1.24833 1.17683 1.11898ZM3.8693 8.50049L2.32155 13.5307L13.382 8.00049L2.32155 2.47027L3.8693 7.50049H9.50001C9.77615 7.50049 10 7.72435 10 8.00049C10 8.27663 9.77615 8.50049 9.50001 8.50049H3.8693Z"/>
```

---

## Cell Action Bar -- Full Example

The action bar floats at the top-left of its parent cell. Draw it **after** the cell rect in SVG document order so it renders on top.

```svg
<!-- Cell action bar: x=CELL_X, y=CELL_TOP-10, width=88, height=16 -->
<rect x="30" y="66" width="88" height="16" rx="3" fill="#FFFFFF" stroke="#E0E0E0" stroke-width="1"/>

<!-- notebook-execute -->
<g transform="translate(35, 68) scale(0.7)" fill="#5A5A5A">
  <path d="M3.78 2L3 2.41v12l.78.42 9-6V8l-9-6zM4 13.48V3.35l7.6 5.07L4 13.48z"/>
</g>

<!-- vertical separator between execute and the rest -->
<line x1="51" y1="70" x2="51" y2="78" stroke="#D0D0D0" stroke-width="1"/>

<!-- debug-alt-small -->
<g transform="translate(55, 68) scale(0.7)" fill="#5A5A5A">
  <path d="M7.293 9.006l-.88.88A2.484 2.484 0 0 0 4 8a2.488 2.488 0 0 0-2.413 1.886l-.88-.88L0 9.712l1.147 1.146-.147.146v1H0v.999h1v.053c.051.326.143.643.273.946L0 15.294.707 16l1.1-1.099A2.873 2.873 0 0 0 4 16a2.875 2.875 0 0 0 2.193-1.099L7.293 16 8 15.294l-1.273-1.292A3.92 3.92 0 0 0 7 13.036v-.067h1v-.965H7v-1l-.147-.146L8 9.712l-.707-.706zM4 9.006a1.5 1.5 0 0 1 1.5 1.499h-3A1.498 1.498 0 0 1 4 9.006zm2 3.997A2.217 2.217 0 0 1 4 15a2.22 2.22 0 0 1-2-1.998v-1.499h4v1.499z"/>
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M5 2.41L5.78 2l9 6v.83L9 12.683v-1.2l4.6-3.063L6 3.35V7H5V2.41z"/>
</g>

<!-- run-above -->
<g transform="translate(70, 68) scale(0.7)" fill="#5A5A5A">
  <path d="M1.77 1.01L1 1.42v12l.78.42 9-6v-.83l-9.01-6zM2 12.49V2.36l7.6 5.07L2 12.49zM12.15 8h.71l2.5 2.5-.71.71L13 9.56V15h-1V9.55l-1.65 1.65-.7-.7 2.5-2.5z"/>
</g>

<!-- ellipsis -->
<g transform="translate(85, 68) scale(0.7)" fill="#5A5A5A">
  <path d="M4 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
</g>

<!-- trash -->
<g transform="translate(100, 68) scale(0.7)" fill="#5A5A5A">
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
</g>
```
