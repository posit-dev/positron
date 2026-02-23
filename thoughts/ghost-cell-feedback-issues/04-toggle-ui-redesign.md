---
title: Replace ghost cell Automatic/On Demand toggle with dropdown selector
labels: area: notebooks, notebooks-ai, enhancement, design-needed, usability, theme: new notebook frontend
repository: posit-dev/positron
---

The current fill-style toggle for Automatic vs On Demand mode is unclear and
takes up too much horizontal space in the ghost cell UI.

## Problems

- The filled/unfilled visual treatment does not clearly indicate which option is
  selected (white = selected, grey = unselected is not intuitive)
- The toggle takes up significant horizontal space, crowding the prompt area

## Proposed changes

- Replace the toggle with a compact dropdown selector
- Move the selector to the bottom of the cell to free up room for the prompt
  to display without getting cut off

## Context

This affects the ghost cell toolbar/header area. A dropdown would be more
compact and have clearer selection semantics.
