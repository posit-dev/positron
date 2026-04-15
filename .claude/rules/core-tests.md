---
paths:
  - src/**/*.{test,integrationTest}.{ts,tsx}
---

# Core Tests (Mocha)

Legacy Mocha tests in `src/`, run via `./scripts/test.sh`. Used by upstream VS Code tests. New Positron tests should use Vitest (`.vitest.ts` / `.vitest.tsx`) instead.

For the builder pattern and presets, see the JSDoc on `PositronTestContainerBuilder` in `src/vs/workbench/test/browser/positronTestContainer.ts`.
