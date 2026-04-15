---
paths:
  - src/**/*.{test,integrationTest}.{ts,tsx}
---

# Core Tests (Mocha)

Legacy Mocha tests in `src/`, run via `./scripts/test.sh`. Used by upstream VS Code tests.

**Do not create new `.test.ts` files for Positron code.** Use Vitest (`.vitest.ts` / `.vitest.tsx`) instead -- see the decision table in CLAUDE.md and `.claude/rules/vitest.md` for patterns.

If you're modifying an existing Mocha test, match its conventions: `suite()`, `test()`, `assert`, `ensureNoDisposablesAreLeakedInTestSuite()` from `utils.js`.
