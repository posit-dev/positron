# Save Test File

Write a standalone `.test.ts` file when saving (via `--save` flag, or user said yes to prompt).

## File Path

`test/e2e/tests/_generated/MMDD-<increment>_<pr>-<slug>.test.ts`
- `MMDD` is the current date (e.g., `0405`)
- `<increment>` is a sequential number for the day -- count existing `MMDD-*` files and add 1.
  Run **only** this command to get the count. Do NOT glob or list all files in `_generated/`.
  ```bash
  ls test/e2e/tests/_generated/MMDD-* 2>/dev/null | wc -l
  ```
  First run of the day = `1`, second = `2`, etc.
- `<pr>` is the PR number if available, omit if free-text or `--branch`
- `<slug>` is a short kebab-case summary (e.g., `variable-filter`)
- Examples:
  - `test/e2e/tests/_generated/0405-1_456-notebook-outline.test.ts` (first run)
  - `test/e2e/tests/_generated/0405-2_456-notebook-outline.test.ts` (second run)
  - `test/e2e/tests/_generated/0405-3_console-sessions.test.ts` (third run, free-text)

## Format

Follow `../shared-e2e-references/test-conventions.md` for structure, imports,
indentation, and copyright header. Key differences for QA-generated tests:
- Import from `./_qa.setup`, not `../_test.setup`
- Use `test.describe('Verify PR #<number>: <short summary>')` as the parent block
- For free-text tests (no PR number), use `test.describe('Verify: <description>')`

## Rules

- **Do NOT read existing test files in `_generated/` for reference.** Write the
  test from your runner results and the reference docs listed in this file.
  Reading other tests leads to pattern copying instead of reflecting what you
  actually observed.

- **Always use fixtures over workbench properties when available.** Fixtures come
  from the test function parameter, NOT from `app.workbench`. Read
  `test/e2e/tests/_test.setup.ts` for the full list of available fixtures, their
  types, and JSDoc usage examples. Key rules:
  - Add fixtures (`settings`, `hotKeys`, `createFile`, `openFile`, etc.) to the
    test function signature -- do NOT destructure them from `app.workbench`
    (different types, missing path resolution, etc.)
  - Use `hotKeys` fixture over `quickaccess.runCommand` when a hotkey exists --
    check `pom-ref/hotKeys.md` before writing any `quickaccess.runCommand(...)` call
  - Use `openFile` fixture (not `quickaccess.openFile`) to re-open workspace files --
    the fixture resolves relative paths; `quickaccess.openFile` requires absolute paths
  - Map runner `createFile` action to the `createFile` fixture (writes to disk,
    opens in editor, auto-cleans up on test end)
  - Use `sessions.start()` return values (`.id`, `.name`) -- never hardcode version strings
- **Do NOT wrap POM calls in `test.step()`.** POM methods already have internal
  `test.step()` wrappers. Use comments to group steps, not `test.step()`.
- **Do NOT rename `console` when destructuring.** Use `const { console } = app.workbench`
  directly -- shadowing the global `console` is fine in test files.
