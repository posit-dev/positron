---
title: Add indicator in notebook navigation when ghost cell suggestion exists off-screen
labels: area: notebooks, notebooks-ai, enhancement, theme: new notebook frontend
repository: posit-dev/positron
---

When a ghost cell suggestion appears at the bottom of a notebook and the user
is scrolled up, there is no indication that a suggestion is available.

## Proposed behavior

- Add a subtle indicator (e.g., an icon or badge) in the notebook navigation
  area when a suggestion exists off-screen
- Clicking the indicator should scroll to the suggestion

## Context

This is a discoverability improvement. Users may not know a suggestion was
generated if they are working in cells above the suggestion location.
