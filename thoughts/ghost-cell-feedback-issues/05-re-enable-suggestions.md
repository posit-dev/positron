---
title: No way to re-enable ghost cell suggestions after clicking "don't suggest"
labels: area: notebooks, notebooks-ai, enhancement, usability, theme: new notebook frontend
repository: posit-dev/positron
---

After clicking "don't suggest" on a ghost cell suggestion, there is no
discoverable way to get suggestions back in the current notebook session.

## Expected behavior

Users should have a clear path to re-enable suggestions after dismissing them.
Options could include:

- A setting or command palette action to re-enable
- A subtle UI affordance in the notebook toolbar
- Re-enabling on next cell execution or notebook reopen

## Context

Without a re-enable path, "don't suggest" effectively becomes a permanent
(per-session) opt-out with no undo, which may discourage users from dismissing
suggestions even when they want to temporarily.
