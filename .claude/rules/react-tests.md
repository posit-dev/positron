---
paths:
  - src/**/*.test.tsx
---

# React Tests

React component tests run in Electron (not browser). No React testing libraries are available - only `assert`, `sinon`, `react-dom`, and `react-dom/client`.

## Setup

Use `setupReactRenderer()` from `base/test/browser/react.js` for DOM/root lifecycle. Call it **before** `ensureNoDisposablesAreLeakedInTestSuite()` (mocha teardown is FIFO -- React must unmount before the leak checker runs).

## Constraints

- Place tests in `test/browser/` adjacent to source.
- `container()` is a function -- call it inside tests, not at suite-definition time.
- `querySelector` requires `/* eslint-disable no-restricted-syntax */` below the copyright header.
