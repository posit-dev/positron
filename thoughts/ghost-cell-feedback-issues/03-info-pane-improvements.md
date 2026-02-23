---
title: Improve ghost cell info pane: explain model choice and show keyboard shortcut
labels: area: notebooks, notebooks-ai, enhancement, theme: new notebook frontend
repository: posit-dev/positron
---

The ghost cell info pane should provide more context to help users understand
the feature behavior.

## Proposed changes

1. **Explain model selection** - Add text explaining why the selected model may
   differ from what is configured in Assistant. Currently the ghost cell feature
   uses a cheaper/faster model from the selected provider for performance and cost
   reasons. This should be surfaced so users understand the mismatch.

2. **Show keyboard shortcut** - Display the keyboard shortcut (Cmd+Shift+G) in
   the info pane so users can discover the manual trigger without needing to
   search keybindings.

## Context

Users currently see a model in the info pane that differs from their Assistant
configuration with no explanation, which causes confusion.
