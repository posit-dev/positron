---
paths:
  - src/**/*.test.tsx
---

# React Tests

React component tests run in Electron with `assert`, `sinon`, and `react-dom`. No React testing libraries (Testing Library, Enzyme, etc.) are available.

## Setup

Use `setupReactRenderer()` from `base/test/browser/react.js` to manage the DOM container and React root. Call it **before** `ensureNoDisposablesAreLeakedInTestSuite()` -- mocha teardown is FIFO, so React must unmount before the leak checker runs.

## Test organization

Write tests as a behavioral spec for the component. Each test is one input scenario (a distinct combination of props/state) that asserts everything observable about the result.

## General

- Place tests in `test/browser/` adjacent to source.
- `render()` returns the DOM container -- query it for assertions.
- `querySelector<T>` requires `/* eslint-disable no-restricted-syntax */` below the copyright header.
- Extract DOM queries into getters on a reusable fixture class.
