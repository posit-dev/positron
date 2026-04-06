# Design Spec: /write-tests Slash Command

## Problem

The Vitest infrastructure, tier system, and mocking guide exist -- but a developer still has to read the docs, figure out which tier applies to their code, and write the test from scratch. The `/write-tests` command closes that gap by analyzing the dev's branch, recommending what to test and how, and writing the tests after confirmation.

## How It Works

The dev types `/write-tests` (or `/write-tests --branch feature/my-work`) in Claude Code. The command runs in two phases.

### Phase 1: Analysis

1. Run `git diff main...HEAD` (or `git diff main...<branch>` if `--branch` is specified) to find changed files
2. Filter to source files (exclude existing tests, docs, configs, generated files)
3. Classify each changed file:

**Positron files** (Posit copyright header):
- Check if a `.vitest.ts` test already exists
- Determine the right tier by analyzing constructor dependencies
- Tier 0: no `@IServiceId` decorators (pure logic)
- Tier 1: 1-5 service deps, all already mocked
- Tier 2: depends on runtime/language/console services
- Tier 3: needs notebooks, plots, webviews, or other workbench services
- For `.tsx` files: check imports -- pure presentational component (Vitest Tier 0-1), component with service context (Vitest Tier 2-3), or tightly coupled to VS Code editor lifecycle (flag for E2E)

**Upstream files** (Microsoft copyright):
- Flag with a warning: "You modified upstream VS Code code. Verify with existing Mocha tests."
- Provide the exact `./scripts/test.sh --run <file>` command to run

**Extension files** (`extensions/positron-*/`):
- Check if the file imports `vscode`/`positron`
- If no: recommend Vitest (same as core Positron)
- If yes: recommend extension host test (`npm run test-extension`)

4. Present the test plan:

```
Your branch changed 6 files:

Tests to write:
  1. src/vs/workbench/services/positronHelp/browser/positronHelpService.ts
     → Tier 2 (depends on IRuntimeSessionService, ICommandService -- covered by .withRuntimeServices())
     → No existing test

  2. src/vs/workbench/contrib/positronConsole/common/linkDetector.ts
     → Tier 0 (pure function, no service dependencies)
     → Already has test ✓ -- will check if your changes are covered

  3. extensions/positron-assistant/src/providers/snowflake/snowflakeProvider.ts
     → Tier 1 (light deps, already has Vitest stub for positron module)
     → No existing test

Already covered:
  4. src/vs/workbench/contrib/positronQuarto/common/quartoParser.ts
     → Has quartoParser.vitest.ts ✓

Upstream (not Vitest -- verify manually):
  5. src/vs/editor/test/browser/config/editorConfiguration.test.ts
     → Run: ./scripts/test.sh --run src/vs/editor/test/browser/config/editorConfiguration.test.ts

Skipped:
  6. src/vs/workbench/contrib/positronHelp/browser/positronHelp.contribution.ts
     → Registration wiring, no testable logic

Want me to write tests for items 1-3?
```

5. Wait for dev feedback before proceeding.

### Phase 2: Writing (after approval)

For each approved test:
1. Read the source file to understand public methods, events, and behavior
2. Generate the `.vitest.ts` file following the tier's pattern from CLAUDE.md
3. Use incremental mocking: start with the tier preset, add stubs only as needed
4. Run the test: `npx vitest run <file>`
5. Show results to the dev
6. Ask: "Looks good? Any adjustments?"
7. Move to next file
8. After all tests written, run the full suite: `npx vitest run`

### Usage

```
/write-tests                            # analyze current branch vs main
/write-tests --branch feature/my-work   # analyze a specific branch vs main
```

## What the Command Does NOT Do

- Write Mocha tests for upstream VS Code code (warns instead, provides the run command)
- Write E2E Playwright tests (different skill: `positron-e2e-tests`)
- Auto-commit (dev reviews and commits when ready)
- Modify existing tests (only creates new `.vitest.ts` files)

## File Location

`.claude/commands/write-tests.md`

## References the Command Reads

- `CLAUDE.md` -- tier definitions, mocking guide, decision tree
- `docs/superpowers/specs/2026-04-03-vitest-migration-design.md` -- coverage gap table, testing pyramid
- `.claude/rules/core-tests.md` -- disposable and service patterns (NOTE: currently stale, references Mocha patterns. Should be updated to reference Vitest as part of implementation.)
- The source file being tested -- to understand what to assert
- Existing `.vitest.ts` files in the same area -- to follow established patterns
