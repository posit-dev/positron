# Reading UI state without lying to yourself

Every failure below produces a plausible, wrong answer rather than an error. If
a reading of the workbench disagrees with a screenshot, the reading is wrong
until proven otherwise.

## Virtualized lists are moved with a transform, not `scrollTop`

Lists built on `monaco-list` -- the quick pick, the tree views, the notebook
cell list -- render only a window of rows around the focused one. The rows that
are off screen are not in the DOM, and the window is positioned by a CSS
transform on `.monaco-list-rows`.

Consequences:

- Counting `.monaco-list-row` elements counts the render window, not the list.
  A list of 40 items reads as 12 rows and looks like it is missing items.
- Setting `element.scrollTop` does nothing and reports no error. Reading
  `scrollTop` back gives `0` whatever the list is showing.
- Each row's real position is `data-index`. Use it rather than the position of
  the element among its siblings, which is the position in the render window.

To read a whole list, drive it with the keys the widget itself handles and
harvest the rows that render at each step. `scripts/quickpick-enum.sh` does this
for a quick pick.

## Closed quick input widgets stay in the DOM

Dismissing a quick pick hides its widget; it does not remove it. A second picker
adds another `.quick-input-widget` to the DOM, so `querySelector` returns
whichever is first, which is usually the stale one.

Select the live widget by visibility:

```js
Array.from(document.querySelectorAll('.quick-input-widget'))
    .find(w => w.offsetParent !== null)
```

The same hazard applies to keystrokes: a `press` aimed at a picker that has
already closed lands wherever focus actually is, which is often the console, so
the keys are silently executed as input.

## Quick pick headings are rows, and arrow keys skip them

A separator can appear two ways, and which one you get depends on the pick:

- as its own row, whose `.quick-input-list-entry` carries
  `quick-input-list-separator-as-item`;
- attached to the item below it, in a `.quick-input-list-separator` element
  inside that item's entry, hidden with `display: none` when the item has no
  separator.

Arrow-key focus only ever lands on items, never on separator rows
(`quickInputList.ts` filters focus to `QuickPickItemElement`). So a walk of the
list reports items in order but has to pick up headings from the rows that
happen to be rendered, and `data-index` is what interleaves the two back into
list order.

Single-select picks loop at the end of the list (`shouldLoop = !canSelectMany`).
A walk that expects to stop at the bottom will run forever; a walk that stops
when focus returns to its starting row also leaves the picker as it found it.

## Confirm the measurement can see what you think it sees

Before reporting that something is absent, prove the reading method can see a
thing you know is present. A selector that matches nothing, a list read through
the wrong container, and a genuinely empty list are indistinguishable in the
output.

Cheap checks that catch most of it:

- Take a screenshot and compare it against the reading. Disagreement means the
  reading is wrong.
- Read back a value you just set, rather than assuming the write took effect.
- Count something with a known answer, such as the number of headings visible
  in the screenshot, before trusting a count with an unknown one.
