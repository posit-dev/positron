---
title: Keyboard shortcut (Cmd+Shift+G) does not trigger ghost cell suggestion
labels: area: notebooks, notebooks-ai, bug, theme: new notebook frontend
repository: posit-dev/positron
---

The keyboard shortcut Cmd+Shift+G to manually generate a ghost cell suggestion
does not appear to work.

## Steps to reproduce

1. Open a Positron notebook
2. Have ghost cell suggestions enabled (on-demand or automatic mode)
3. Focus a code cell
4. Press Cmd+Shift+G
5. No suggestion is generated

## Expected behavior

Pressing Cmd+Shift+G should trigger a ghost cell suggestion for the current
notebook context.

## Notes

Reported on daily build. Needs investigation to determine if this is a
keybinding registration issue, a when-clause issue, or something else.
