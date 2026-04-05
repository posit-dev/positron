# E2E Skill Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared e2e test knowledge into a common reference directory, rename skills to `e2e-author` and `e2e-verify`, and update cross-references.

**Architecture:** Create a shared references directory that both skills read from via relative paths. Move overlapping knowledge (conventions, fixtures, POM patterns, common mistakes) there. Slim both SKILL.md files by replacing inline content with references. Rename directories.

**Tech Stack:** Markdown skill files, Claude Code skill system.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `.claude/skills/shared-e2e-references/test-conventions.md` | Create | Imports, suiteId, function syntax, commenting style, test.step() rules |
| `.claude/skills/shared-e2e-references/fixtures.md` | Create | Fixture table, selection logic, session ID patterns, $pom refs, setup patterns |
| `.claude/skills/shared-e2e-references/pom-patterns.md` | Create | POM-first approach, method selection, confusable methods, quote normalization |
| `.claude/skills/shared-e2e-references/common-mistakes.md` | Create | Merged 26 original + new mistakes from e2e-verify experience |
| `.claude/skills/e2e-author/SKILL.md` | Create (from rename) | Slimmed SKILL.md referencing shared docs + e2e-author-specific content |
| `.claude/skills/e2e-author/references/` | Keep subset | assertions.md, test-structure.md, test-setup.md, page-objects.md (e2e-author-specific) |
| `.claude/skills/e2e-verify/SKILL.md` | Create (from rename) | Slimmed SKILL.md referencing shared docs + runner/verify-specific content |
| `.claude/skills/positron-e2e-tests/` | Delete | Replaced by e2e-author |
| `.claude/skills/qa-test/` | Delete | Replaced by e2e-verify |
| Memory files | Update | Update references to old skill names |

---

### Task 1: Create shared reference files

**Files:**
- Create: `.claude/skills/shared-e2e-references/test-conventions.md`
- Create: `.claude/skills/shared-e2e-references/fixtures.md`
- Create: `.claude/skills/shared-e2e-references/pom-patterns.md`
- Create: `.claude/skills/shared-e2e-references/common-mistakes.md`

- [ ] **Step 1: Create `test-conventions.md`**

Extract from both skills. Content should cover:
- Imports: `../_test.setup` not `@playwright/test` (from e2e-tests common-mistakes #1)
- `suiteId: __filename` requirement (from both)
- `function` syntax not arrow functions (from both)
- Tabs for indentation (from qa-test)
- Copyright header format (from qa-test Step 6)
- Commenting style: intent-driven, one comment per logical group, not per call. Groups separated by blank lines. Reference: `test/e2e/tests/variables/variables-filter.test.ts` (from qa-test)
- `test.step()` rules: wrap raw Playwright sequences for readability, but NEVER wrap POM calls since they already have internal `test.step()` wrappers (from both -- qa-test has the correct nuanced rule)
- Destructure `app.workbench` at the top of test body (from qa-test)

Source content:
- qa-test SKILL.md Step 6 "Rules" section (~lines 775-816)
- positron-e2e-tests SKILL.md "Critical: Test File Structure" section
- positron-e2e-tests references/common-mistakes.md items 1-6

- [ ] **Step 2: Create `fixtures.md`**

Merge from both skills. Content should cover:
- Fixture table: `app`, `python`, `r`, `sessions`, `page`, `hotKeys`, `settings`, `executeCode`, `openFile`, `cleanup` with use-case descriptions
- When to use `python` fixture vs `sessions.start()` -- use fixtures for simple cases, `sessions.start()` with destructuring when you need session IDs
- Session ID destructuring pattern: `const [pySession] = await sessions.start(['python'])` (from qa-test)
- `$pom` references in runner args: `{"$pom": "settings"}` resolves to the actual POM instance (from qa-test)
- Setup patterns to look for in existing tests: `enablePositronNotebooks(settings)`, `settings.set({...}, {reload: true})`, `assistant.loginModelProvider(...)` (from qa-test)
- Worker-scoped vs test-scoped fixture distinction (from e2e-tests references/fixtures.md)

Source content:
- positron-e2e-tests references/fixtures.md (429 lines -- use as base)
- qa-test SKILL.md Step 6 fixture rules and session ID guidance
- qa-test SKILL.md setup patterns section

- [ ] **Step 3: Create `pom-patterns.md`**

Primarily from qa-test, new for e2e-author. Content should cover:
- Always read `pom-reference.md` before choosing methods (and how to regenerate it if stale)
- Copy-paste method names from the reference, never abbreviate or paraphrase
- Read the `--` description after each method signature before choosing
- Common confusable methods with cross-references:
  - `clickDatabaseIconForVariableRow` is unreliable, use `openVariableInDataExplorer`
  - `waitForCurrentPlot` vs `waitForPlotInFullSizeViewer`
  - `clickDeleteAllVariables` is deprecated, use `deleteAllVariables`
  - `clickText` can be ambiguous, use scoped POM methods (e.g., `clickOutlineElement`)
- `expectVariableToBe` quote normalization: Python uses `'`, R uses `"`, the POM normalizes automatically
- POM-first rule: never use raw selectors/evaluate/screenshots for assertions when a POM method exists
- POM source files are in `test/e2e/pages/` for checking complex parameter shapes

Source content:
- qa-test SKILL.md "CRITICAL" blocks about method names (~lines 253-267)
- qa-test SKILL.md Tips section (POM-related items)
- qa-test SKILL.md "POM first, raw never" section

- [ ] **Step 4: Create `common-mistakes.md`**

Merge the existing 26 gotchas with new ones from e2e-verify. Use the existing e2e-tests file as the base and append new items.

New mistakes to add (from e2e-verify experience):
- #27: `deleteAllVariables` shows a confirmation dialog -- the old `clickDeleteAllVariables` didn't handle it
- #28: `clickText` on outline entries matches both outline tree and rendered content -- use `clickOutlineElement` instead
- #29: `enablePositronNotebooks` needs the settings POM passed with reload option
- #30: Small Python lists (< 5 elements) display inline contents (`[1, 2, 3]`), not summary format (`[3] list`)
- #31: `executeCode` on built apps may need longer timeouts -- pass timeout in options object
- #32: String variables display with language-specific quoting -- Python `'hello'`, R `"hello"` -- but `expectVariableToBe` normalizes automatically

Source content:
- positron-e2e-tests references/common-mistakes.md (588 lines -- use as base)
- Append new items from qa-test experience

- [ ] **Step 5: Commit shared references**

```bash
git add .claude/skills/shared-e2e-references/
git commit -m "feat: create shared e2e reference docs for test conventions, fixtures, POM patterns, common mistakes"
```

---

### Task 2: Rename and update e2e-author

**Files:**
- Create: `.claude/skills/e2e-author/SKILL.md`
- Move: `.claude/skills/positron-e2e-tests/references/` -> `.claude/skills/e2e-author/references/`
- Delete from references: `fixtures.md`, `common-mistakes.md` (now in shared)
- Delete: `.claude/skills/positron-e2e-tests/`

- [ ] **Step 1: Create e2e-author directory and copy references**

```bash
mkdir -p .claude/skills/e2e-author/references
cp .claude/skills/positron-e2e-tests/references/assertions.md .claude/skills/e2e-author/references/
cp .claude/skills/positron-e2e-tests/references/page-objects.md .claude/skills/e2e-author/references/
cp .claude/skills/positron-e2e-tests/references/test-structure.md .claude/skills/e2e-author/references/
cp .claude/skills/positron-e2e-tests/references/test-setup.md .claude/skills/e2e-author/references/
# Do NOT copy fixtures.md or common-mistakes.md -- those are now in shared-e2e-references
```

- [ ] **Step 2: Create e2e-author SKILL.md**

Write a new SKILL.md that:
- Has frontmatter: `name: e2e-author`, description about writing/debugging/maintaining e2e tests, `user-invocable: false`
- Keeps the quick-reference tables from the original (fixtures table, tags, assertions snippets)
- References shared docs instead of inline content:
  - `See ../shared-e2e-references/test-conventions.md for code conventions.`
  - `See ../shared-e2e-references/fixtures.md for fixture selection and usage.`
  - `See ../shared-e2e-references/pom-patterns.md for POM method selection.`
  - `See ../shared-e2e-references/common-mistakes.md for common mistakes to avoid.`
- Keeps e2e-author-specific content: tag system, CLI running/debugging, test structure template
- Adds "See also" note: `To verify a feature on-demand without writing a test file, use /e2e-verify.`
- Updates the `variables.doubleClickVariableRow` reference on line 89 to `variables.openVariableInDataExplorer`

Source: Read current `.claude/skills/positron-e2e-tests/SKILL.md` and restructure. The goal is ~150-180 lines with progressive disclosure via references.

- [ ] **Step 3: Delete old positron-e2e-tests directory**

```bash
rm -rf .claude/skills/positron-e2e-tests
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/e2e-author/ .claude/skills/positron-e2e-tests/
git commit -m "feat: rename positron-e2e-tests to e2e-author, reference shared docs"
```

---

### Task 3: Rename and slim e2e-verify

**Files:**
- Create: `.claude/skills/e2e-verify/SKILL.md`
- Delete: `.claude/skills/qa-test/`

- [ ] **Step 1: Create e2e-verify directory**

```bash
mkdir -p .claude/skills/e2e-verify
```

- [ ] **Step 2: Create e2e-verify SKILL.md**

Copy the current qa-test SKILL.md and make these changes:
- Update frontmatter: `name: e2e-verify`, update description
- Replace inline test convention rules (Step 6 "Rules" section, ~20 lines) with references:
  - `See ../shared-e2e-references/test-conventions.md for code conventions.`
  - `See ../shared-e2e-references/fixtures.md for fixture selection.`
  - `See ../shared-e2e-references/pom-patterns.md for POM method selection.`
  - `See ../shared-e2e-references/common-mistakes.md for common gotchas.`
- Replace inline POM selection rules (the CRITICAL blocks, ~15 lines) with reference to `pom-patterns.md`
- Keep ALL runner-specific content: HTTP API, diff analysis, --branch/--deep, reporting, verification comments, POM Health, retry logic, browser selection, custom actions
- Add "See also" note: `For hand-writing permanent e2e tests with Playwright, see the e2e-author skill.`
- Keep the Step 6 save format (file path, imports, test structure) but reference shared conventions for the style rules

Target: ~750 lines (down from 935 -- removed ~200 lines of inline conventions/POM rules now in shared refs).

- [ ] **Step 3: Delete old qa-test directory**

```bash
rm -rf .claude/skills/qa-test
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/e2e-verify/ .claude/skills/qa-test/
git commit -m "feat: rename qa-test to e2e-verify, slim SKILL.md with shared references"
```

---

### Task 4: Update cross-references

**Files:**
- Modify: `.claude/skills/qa-test-plan/SKILL.md` (if it references qa-test)
- Modify: Memory files that reference old names
- Modify: `test/e2e/tests/explore/BACKLOG.md` (if it references qa-test)

- [ ] **Step 1: Search for all references to old skill names**

```bash
grep -r "qa-test\|positron-e2e-tests" .claude/ test/e2e/tests/explore/BACKLOG.md --include="*.md" -l
```

- [ ] **Step 2: Update each file found**

For each file, replace:
- `qa-test` -> `e2e-verify` (skill name references)
- `/qa-test` -> `/e2e-verify` (invocation references)
- `positron-e2e-tests` -> `e2e-author` (skill name references)

Be careful NOT to replace `qa-test-plan` -- that's a separate skill that stays as-is.

- [ ] **Step 3: Update memory files**

Update the memory files in `.claude/projects/-Users-marieidleman-Develop-positron/memory/`:
- `feedback_qa_rough_edges.md`: Update references from qa-test to e2e-verify
- `feedback_qa_use_pom_methods.md`: Update references from qa-test to e2e-verify
- `project_e2e_skill_rename.md`: Mark as complete
- `MEMORY.md`: Update descriptions

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update all cross-references from qa-test/positron-e2e-tests to e2e-verify/e2e-author"
```

---

### Task 5: Verify and push

- [ ] **Step 1: Verify skill loading**

Check that both skills are discoverable by Claude Code:
```bash
# Both directories exist with SKILL.md
ls .claude/skills/e2e-author/SKILL.md
ls .claude/skills/e2e-verify/SKILL.md
ls .claude/skills/shared-e2e-references/*.md

# Old directories are gone
ls .claude/skills/qa-test/ 2>/dev/null && echo "ERROR: qa-test still exists" || echo "OK: qa-test removed"
ls .claude/skills/positron-e2e-tests/ 2>/dev/null && echo "ERROR: positron-e2e-tests still exists" || echo "OK: positron-e2e-tests removed"
```

- [ ] **Step 2: Verify no dangling references**

```bash
# Should return NO results (except qa-test-plan which is a different skill)
grep -r "qa-test\b" .claude/skills/ --include="*.md" | grep -v "qa-test-plan"
grep -r "positron-e2e-tests" .claude/skills/ --include="*.md"
```

- [ ] **Step 3: Verify shared references are readable from both skills**

```bash
# Both skills should be able to resolve relative paths to shared refs
ls .claude/skills/e2e-author/../shared-e2e-references/test-conventions.md
ls .claude/skills/e2e-verify/../shared-e2e-references/test-conventions.md
```

- [ ] **Step 4: Push**

```bash
git push
```
