---
paths:
  - src/**/*.test.tsx
---

# React Tests

React component tests run in Electron (not browser). No React testing libraries are available - only `assert`, `sinon`, `react-dom`, and `react-dom/client`.

## Constraints

- Place tests in `test/browser/` adjacent to source: `feature/browser/components/foo.tsx` -> `feature/test/browser/foo.test.tsx`
- Use `mainWindow.document` instead of `document` for DOM operations.
- `querySelector` requires `/* eslint-disable no-restricted-syntax */` below the copyright header.
- Render via a helper that wraps `root.render()` in `flushSync()` so React flushes synchronously.
- Teardown order matters: (1) `root.unmount()`, (2) `container.remove()`, (3) `sinon.restore()`.
