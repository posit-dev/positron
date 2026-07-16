# Positron SVG Component Patterns

Copy-pasteable SVG snippets for every major UI component. All assume a 520x260 canvas unless noted. Adjust x/y/width/height to fit your layout.

---

## Screenshot-Driven Workflow

When creating a new abstract image, **ask the user for a screenshot of the actual UI** if available. A screenshot tells you:
- Exact layout and proportions of panels
- Which icons appear in which toolbars (identify by name then look up codicon path)
- Text labels, tab names, column headers
- Which element is the focal point (the thing the feature is trying to explain)

You can also search the Positron codebase for the codicon name used in code (e.g., `Codicon.notebookExecute`) and look it up in `references/codicons.md`.

For file-type icons in the tab bar (e.g., `.ipynb`, `.R`, `.py`), Positron uses the **Seti UI** icon theme: https://github.com/jesseweed/seti-ui. Locally it ships only as a font (`extensions/theme-seti/icons/seti.woff`), so there is no per-file SVG to extract from the repo -- fetch the source SVG from that repo's `icons/` folder (an external network call) or hand-draw a simple file glyph. NOTE: the existing walkthrough SVGs use plain text tab labels, not file-type glyphs, so this seti-icon approach is currently untested -- verify it in a preview and keep the glyph simple.

---

## Tab Bar

Full-width tab bar with one active file tab and close button. The blue underline (`#447099`) is the key active-tab signal.

```svg
<!-- Tab bar background -->
<rect x="0" y="0" width="520" height="28" fill="#F2F2F2"/>
<line x1="0" y1="28" x2="520" y2="28" stroke="#E0E0E0" stroke-width="1"/>

<!-- Active tab (white, blue underline) -->
<rect x="0" y="0" width="148" height="28" fill="#FFFFFF"/>
<line x1="0" y1="27" x2="148" y2="27" stroke="#447099" stroke-width="2"/>
<text x="12" y="18"
      font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="10" fill="#333333">analysis.ipynb</text>
<!-- Close x (two crossing lines) -->
<line x1="131" y1="9" x2="141" y2="19" stroke="#8A8A8A" stroke-width="1.2"/>
<line x1="141" y1="9" x2="131" y2="19" stroke="#8A8A8A" stroke-width="1.2"/>
<!-- Tab right border -->
<line x1="148" y1="0" x2="148" y2="28" stroke="#E0E0E0" stroke-width="1"/>
```

---

## Notebook Toolbar

Full-width toolbar with all standard notebook actions. The Python dropdown is the focal point -- blue border, green session dot.

```svg
<!-- Toolbar background -->
<rect x="0" y="28" width="520" height="34" fill="#FAFAFA"/>
<line x1="0" y1="62" x2="520" y2="62" stroke="#E0E0E0" stroke-width="1"/>

<!-- Run All -->
<g transform="translate(10, 37)" fill="#5A5A5A">
  <path d="M2.78 2L2 2.41v12l.78.42 9-6V8l-9-6zM3 13.48V3.35l7.6 5.07L3 13.48z"/>
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M6 14.683l8.78-5.853V8L6 2.147V3.35l7.6 5.07L6 13.48v1.203z"/>
</g>

<!-- Clear All -->
<g transform="translate(32, 37)" fill="#5A5A5A">
  <path d="M10 12.6l.7.7 1.6-1.6 1.6 1.6.8-.7L13 11l1.7-1.6-.8-.8-1.6 1.7-1.6-1.7-.7.8 1.6 1.6-1.6 1.6zM1 4h14V3H1v1zm0 3h14V6H1v1zm8 2.5V9H1v1h8v-.5zM9 13v-1H1v1h8z"/>
</g>

<!-- + Code (add icon + label) -->
<g transform="translate(54, 40) scale(0.6875)" fill="#5A5A5A">
  <path d="M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z"/>
</g>
<text x="66" y="49" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="10" fill="#5A5A5A">Code</text>

<!-- + Markdown (add icon + label) -->
<g transform="translate(97, 40) scale(0.6875)" fill="#5A5A5A">
  <path d="M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z"/>
</g>
<text x="109" y="49" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="10" fill="#5A5A5A">Markdown</text>

<!-- Refresh (right-side icon, adjust x for full-width vs split layout) -->
<g transform="translate(395, 37)" fill="#5A5A5A">
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/>
</g>

<!-- Python session dropdown (FOCAL POINT -- blue border, green dot) -->
<rect x="415" y="34" width="92" height="22" rx="4" fill="#FFFFFF" stroke="#447099" stroke-width="1.5"/>
<circle cx="425" cy="45" r="4" fill="#3DAA6E"/>
<text x="433" y="49" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9.5" fill="#333333">Python</text>
<g transform="translate(492, 40) scale(0.625)" fill="#5A5A5A">
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/>
</g>
```

---

## Code Cell -- Active (blue border, with combined output)

The active cell has a blue border. Code area is gray; output area is white. Both share a single outer rect. Draw the action bar **after** this element.

```svg
<!-- Outer cell border (blue = active) -->
<rect x="12" y="70" width="496" height="104" rx="4"
      fill="#FFFFFF" stroke="#447099" stroke-width="1.5"/>
<!-- Code area gray background -->
<rect x="13.5" y="71.5" width="493" height="60" fill="#F8F8F8"/>
<!-- Separator between code and output -->
<line x1="13" y1="131" x2="507" y2="131" stroke="#EEEEEE" stroke-width="1"/>

<!-- Line numbers (text-anchor end, 20px from cell left edge) -->
<text x="30" y="86" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">1</text>
<text x="30" y="98" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">2</text>
<text x="30" y="110" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">3</text>
<text x="30" y="122" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">4</text>

<!-- Placeholder code lines (code starts 26px from cell left edge) -->
<rect x="38" y="82" width="200" height="4" rx="2" fill="#C8C8C8"/>
<rect x="38" y="94" width="80"  height="4" rx="2" fill="#C8C8C8"/>
<rect x="38" y="106" width="130" height="4" rx="2" fill="#C8C8C8"/>
<rect x="38" y="118" width="160" height="4" rx="2" fill="#C8C8C8"/>

<!-- Output: bar chart (see Bar Chart Output pattern below) -->
```

---

## Code Cell -- Inactive (gray border)

```svg
<rect x="12" y="184" width="496" height="42" rx="4"
      fill="#F8F8F8" stroke="#E0E0E0" stroke-width="1"/>
<!-- Line numbers -->
<text x="30" y="200" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">1</text>
<text x="30" y="212" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">2</text>
<text x="30" y="224" font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8DA5B8" text-anchor="end">3</text>
<!-- Placeholder code lines -->
<rect x="38" y="196" width="180" height="4" rx="2" fill="#C8C8C8"/>
<rect x="38" y="208" width="240" height="4" rx="2" fill="#C8C8C8"/>
<rect x="38" y="220" width="150" height="4" rx="2" fill="#C8C8C8"/>
```

---

## Markdown Cell

```svg
<rect x="12" y="236" width="496" height="18" rx="4"
      fill="#FFFFFF" stroke="#E0E0E0" stroke-width="1"/>
<rect x="22" y="243" width="180" height="4" rx="2" fill="#AAAAAA"/>
```

---

## Bar Chart Output

A compact 6-bar chart for small output areas (~38px tall). Adjust bar heights and x positions to fit. Baseline is a light gray line.

```svg
<!-- 6 bars, baseline at y=BASELINE -->
<rect x="25"  y="143" width="6" height="16" fill="#447099" opacity="0.7"/>
<rect x="37"  y="150" width="6" height="9"  fill="#447099" opacity="0.7"/>
<rect x="49"  y="141" width="6" height="18" fill="#447099" opacity="0.7"/>
<rect x="61"  y="146" width="6" height="13" fill="#447099" opacity="0.7"/>
<rect x="73"  y="143" width="6" height="16" fill="#447099" opacity="0.7"/>
<rect x="85"  y="152" width="6" height="7"  fill="#447099" opacity="0.7"/>
<line x1="19" y1="159" x2="105" y2="159" stroke="#DDDDDD" stroke-width="0.8"/>
```

For a **large output area** (~110px), use wider bars (width=12) and taller heights. Add x-axis tick labels as 10x3 gray rects below the baseline.

---

## Execution Count

Positioned to the left of the cell, aligned to the **top of the output area** (not the center of the whole cell).

```svg
<text x="2" y="OUTPUT_TOP_PLUS_12"
      font-family="'Consolas', 'SF Mono', 'Menlo', monospace"
      font-size="9" fill="#8A8A8A">[1]</text>
```

---

## Cell Action Bar

See `references/codicons.md` for the full ready-to-use snippet.

Key rules:
- Position bar rect: `x=CELL_X`, `y=CELL_TOP - 10`, `height=16`, `rx=3`
- **Draw the action bar AFTER the cell rect** -- SVG renders in document order, so later = on top
- Always include a vertical separator (`stroke="#D0D0D0"`) after the execute icon

---

## Vertical Panel Separator

```svg
<line x1="355" y1="0" x2="355" y2="260" stroke="#E0E0E0" stroke-width="1"/>
```

---

## Variables Pane (right panel)

Typically occupies the right 165px (x=355 to x=520) of a 520px canvas.

```svg
<!-- Header -->
<rect x="355" y="28" width="165" height="34" fill="#F4F4F4"/>
<line x1="355" y1="62" x2="520" y2="62" stroke="#E0E0E0" stroke-width="1"/>
<text x="365" y="49"
      font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9.5" font-weight="500" fill="#3E4246" letter-spacing="0.8">VARIABLES</text>
<!-- Refresh icon (right side of header) -->
<g transform="translate(478, 37)" fill="#5A5A5A">
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"/>
</g>
<!-- Trash icon -->
<g transform="translate(498, 37)" fill="#5A5A5A">
  <path fill-rule="evenodd" clip-rule="evenodd"
        d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
</g>

<!-- Highlighted variable row (18px tall) -->
<rect x="355" y="62" width="165" height="18" fill="#EEF3F8"/>
<text x="365" y="75" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9" fill="#5A5A5A">x</text>
<text x="420" y="75" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9" fill="#5A5A5A">10</text>
<text x="472" y="75" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9" fill="#5A5A5A">int</text>
<line x1="355" y1="80" x2="520" y2="80" stroke="#EEEEEE" stroke-width="1"/>

<!-- Placeholder rows (repeat for each row, 18px spacing) -->
<rect x="365" y="87" width="28" height="4" rx="2" fill="#C8C8C8"/>
<rect x="420" y="87" width="22" height="4" rx="2" fill="#C8C8C8"/>
<rect x="472" y="87" width="28" height="4" rx="2" fill="#C8C8C8"/>
<line x1="355" y1="98" x2="520" y2="98" stroke="#EEEEEE" stroke-width="1"/>
```

---

## Posit Assistant Panel (left or right)

Typically 225px wide. Header matches the tab bar height (28px).

```svg
<!-- Panel header -->
<rect x="0" y="0" width="225" height="28" fill="#F4F4F4"/>
<line x1="0" y1="28" x2="225" y2="28" stroke="#E0E0E0" stroke-width="1"/>
<text x="12" y="18"
      font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="10" font-weight="500" fill="#3E4246">Posit Assistant</text>

<!-- User message bubble (right-aligned, #EEF3F8) -->
<rect x="69" y="36" width="148" height="28" rx="6" fill="#EEF3F8" stroke="#D0DFE8" stroke-width="1"/>
<rect x="79" y="44" width="108" height="4" rx="2" fill="#8DA5B8"/>
<rect x="79" y="52" width="84"  height="4" rx="2" fill="#8DA5B8"/>

<!-- AI response bubble (left-aligned, #F8F8F8) -->
<rect x="8" y="72" width="209" height="60" rx="6" fill="#F8F8F8" stroke="#E8E8E8" stroke-width="1"/>
<rect x="17" y="82" width="182" height="4" rx="2" fill="#C8C8C8"/>
<rect x="17" y="92" width="160" height="4" rx="2" fill="#C8C8C8"/>
<rect x="17" y="102" width="172" height="4" rx="2" fill="#C8C8C8"/>
```

---

## Context Chip (file attachment pill in AI input box)

Shows the user what file context the AI has. Place inside a taller input box.

```svg
<!-- Taller input box -->
<rect x="8" y="200" width="209" height="54" rx="6" fill="#FFFFFF" stroke="#E0E0E0" stroke-width="1"/>

<!-- Context chip pill -->
<rect x="14" y="207" width="106" height="15" rx="7.5" fill="#EEF3F8" stroke="#C8D9E8" stroke-width="1"/>
<!-- Small doc icon inside chip -->
<rect x="21" y="210.5" width="7" height="8" rx="1" fill="none" stroke="#447099" stroke-width="1"/>
<line x1="23" y1="213" x2="27" y2="213" stroke="#447099" stroke-width="0.8"/>
<line x1="23" y1="215" x2="27" y2="215" stroke="#447099" stroke-width="0.8"/>
<!-- Filename label -->
<text x="33" y="218"
      font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="9" fill="#447099">analysis.ipynb</text>

<!-- Divider between chip area and text entry area -->
<line x1="14" y1="226" x2="209" y2="226" stroke="#EEEEEE" stroke-width="1"/>

<!-- Placeholder text in text area -->
<rect x="14" y="236" width="72" height="4" rx="2" fill="#DDDDDD"/>

<!-- Send button (bottom-right inside text area) -->
<g transform="translate(199, 232) scale(0.82)" fill="#447099">
  <path d="M1.17683 1.11898C1.32953 0.989634 1.54464 0.963786 1.72363 1.05328L14.7236 7.55328C14.893 7.63797 15 7.8111 15 8.00049C15 8.18987 14.893 8.36301 14.7236 8.4477L1.72363 14.9477C1.54464 15.0372 1.32953 15.0113 1.17683 14.882C1.02414 14.7526 0.96328 14.5447 1.02213 14.3534L2.97688 8.00049L1.02213 1.64754C0.96328 1.45627 1.02414 1.24833 1.17683 1.11898ZM3.8693 8.50049L2.32155 13.5307L13.382 8.00049L2.32155 2.47027L3.8693 7.50049H9.50001C9.77615 7.50049 10 7.72435 10 8.00049C10 8.27663 9.77615 8.50049 9.50001 8.50049H3.8693Z"/>
</g>
```
