# E2E Skill Consolidation: Shared References + Rename

## Problem

Two e2e testing skills (`positron-e2e-tests` and `qa-test`) encode overlapping knowledge
about POM patterns, fixtures, test conventions, and common mistakes. They diverge in
quality -- `qa-test` produces cleaner test code because it encodes better patterns for
commenting style, fixture selection, and POM-first method usage. The team uses
`positron-e2e-tests` for hand-writing tests but gets inconsistent quality because
it lacks these patterns. Updates to one skill don't propagate to the other.

## Solution

1. Extract shared knowledge into a common reference directory
2. Rename both skills for clearer intent
3. Cross-reference between skills

## New Names

| Old | New | Invocation | Purpose |
|-----|-----|-----------|---------|
| `positron-e2e-tests` | `e2e-author` | Auto-loaded when writing tests | Guide for hand-writing e2e test code |
| `qa-test` | `e2e-verify` | `/e2e-verify #12345` | AI-driven on-demand verification |

## Shared Reference Directory

**Location:** `.claude/skills/shared-e2e-references/`

Both skills read from this directory for shared knowledge. Updates in one place
benefit both skills.

### Shared files

**`test-conventions.md`** -- How to write test code:
- Imports: use `../_test.setup`, not `@playwright/test`
- `suiteId: __filename` requirement for app isolation
- `function` syntax (not arrow functions) for fixture access
- Tabs for indentation, copyright header
- Commenting style: intent-driven, one comment per logical group, not per call
- `test.step()` rules: wrap raw Playwright sequences for readability, but NEVER
  wrap POM calls (they already have internal `test.step()` wrappers)
- Destructure `app.workbench` at the top of test body

**`fixtures.md`** -- Fixture selection and usage:
- Fixture table: `app`, `python`, `r`, `sessions`, `page`, `hotKeys`, `settings`, etc.
- When to use `python` fixture vs `sessions.start()`
- Session ID destructuring: `const [pySession] = await sessions.start(['python'])`
- `$pom` references for runner args: `{"$pom": "settings"}`
- Setup patterns: `enablePositronNotebooks(settings)`, `settings.set({...}, {reload: true})`

**`pom-patterns.md`** -- POM method selection:
- Always read `pom-reference.md` before choosing methods
- Copy-paste method names from the reference, never abbreviate
- Read the `--` description after each signature before choosing
- Common confusable methods (with cross-references)
- `expectVariableToBe` quote normalization (Python `'` vs R `"`)
- POM-first rule: never use raw selectors when a POM method exists

**`common-mistakes.md`** -- Expanded from current 26 gotchas:
- All 26 existing mistakes from `positron-e2e-tests`
- New mistakes from `e2e-verify` experience:
  - `deleteAllVariables` requires dialog confirmation
  - `clickText` ambiguity with outline elements (use `clickOutlineElement`)
  - `enablePositronNotebooks` needs settings POM with reload
  - Small Python lists display inline contents, not summary format
  - `executeCode` timeout on built apps needs longer timeout

### What stays skill-specific

**`e2e-author` keeps:**
- Tag system (`tags.WEB`, `tags.WIN`, `tags.CRITICAL`, feature tags)
- CLI running and debugging (`--headed`, `--debug`, `--grep`)
- Hand-written test structure template with `test.describe` and `beforeAll`/`afterAll`
- Test organization by feature directory
- CI/platform filtering guidance

**`e2e-verify` keeps:**
- Runner HTTP API (`/run-plan`, `/pom`, `/action`, `/batch`, `/done`)
- Diff analysis (`--branch`, `--deep` modes)
- Existing test setup pattern detection
- Test execution, retry logic, and failure handling
- Reporting format (step results, POM Health, rough edges)
- Verification comment template (GitHub markdown + clipboard)
- POM gap detection and backlog tracking
- Browser selection logic
- Custom and raw Playwright actions catalog

## SKILL.md Changes

### e2e-author (currently positron-e2e-tests)

**Slimming:** Replace inline fixture, POM, and convention docs with references
to shared files. Keep quick-reference tables for scanning, but point to shared
docs for details.

**Existing `references/` directory:** Files that overlap with shared refs (fixtures.md,
common-mistakes.md) get deleted. Files that are e2e-author-specific (tags, CLI, test
structure, assertions) stay in `e2e-author/references/`.

**Enhancement:** Gains qa-test's better patterns via shared references:
- POM-first approach (from `pom-patterns.md`)
- Intent-driven commenting style (from `test-conventions.md`)
- Smart fixture selection (from `fixtures.md`)
- Expanded common mistakes (from `common-mistakes.md`)

**Add "See also":**
> To verify a feature on-demand without writing a test file, use `/e2e-verify`.

### e2e-verify (currently qa-test)

**Slimming:** Extract test generation rules into shared references. The ~200 lines
about test conventions, POM patterns, and fixture selection move to shared docs.
Runner API, diff analysis, and reporting stay.

**Add "See also":**
> For hand-writing permanent e2e tests with Playwright, see the `e2e-author` skill.

## Cross-Referencing

Both SKILL.md files reference shared docs with relative paths:
```
See `../shared-e2e-references/test-conventions.md` for test code conventions.
See `../shared-e2e-references/pom-patterns.md` for POM method selection.
```

## Migration

1. Create `.claude/skills/shared-e2e-references/` with 4 shared files
2. Rename `positron-e2e-tests/` to `e2e-author/`, update SKILL.md
3. Rename `qa-test/` to `e2e-verify/`, update SKILL.md
4. Update any cross-references (CLAUDE.md, other skills, memories)
5. Verify both skills load and function correctly
