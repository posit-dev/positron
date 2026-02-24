---
paths:
  - src/**/*.test.tsx
---

# React Tests

React component tests run in Electron with `assert`, `sinon`, and `react-dom`. No React testing libraries (Testing Library, Enzyme, etc.) are available.

## Setup

Use `setupReactRenderer()` from `base/test/browser/react.js` to manage the DOM container and React root. Call it **before** `ensureNoDisposablesAreLeakedInTestSuite()` -- mocha teardown is FIFO, so React must unmount before the leak checker runs.

## General

- Place tests in `test/browser/` adjacent to source.
- `container()` is a function -- call it inside tests, not at suite-definition time.
- `querySelector` requires `/* eslint-disable no-restricted-syntax */` below the copyright header.
