# Reporting Templates

## Full Report Format

Use the `/run-plan` response fields to report results. For each step:
```
Step N: [title]
  Result: PASS / FAIL
  Duration: [duration]ms
  Error: [error message, if failed]
```

Summary format:
```
## PR 456: Variable appears after execution

Target: Local dev (Electron)
Browser: e2e-electron

### Result: PASSED (3/3 steps, 3.3s)

Step 1: Start Python session ............ PASS (2100ms)
Step 2: Execute x = 42 .................. PASS (800ms)
Step 3: Verify x in Variables pane ....... PASS (400ms)
```

**IMPORTANT: If a retry was needed**, even if the final result is PASSED, change the
header to `PASSED after retry` so the user knows it was not a clean pass.

When any step fails, change the header to make the failure obvious:

```
### Result: FAILED (2/3 steps passed, 1 FAILED, 12.1s)

  Failed step: "Verify outline contains [Introduction, Data Loading, Analysis]"
  Error: Timeout 10000ms exceeded
  State: notifications=["Interpreter disconnected"], variableCount=0

Step 1: Start Python session ............ PASS (2100ms)
Step 2: Execute x = 42 .................. PASS (800ms)
Step 3: Verify x in Variables pane ....... FAIL (10023ms)

### State after test
- Active session: Python: idle
- Variables: x
- Notifications: (none)
- Focused panel: console
```

If any step fails, include the error message and enriched state. Use `snapshot` or `takeScreenshot` only if the enriched state is not sufficient to diagnose.

## POM Recommendations

```
### POM Recommendations
[Only include if you had to fall back to raw Playwright actions, retry with
a different approach, or work around a missing/insufficient POM method.
Skip this section if all steps used POM methods successfully.]

File: test/e2e/pages/<pom>.ts

/**
 * Action: <What this method does, one line.>
 * <Why it's needed -- what ambiguity or gap it fixes.>
 * @param <name> - <description>
 */
async <methodName>(<params>): Promise<void> {
	await test.step(`<Human-readable step label>`, async () => {
		<implementation using scoped locators>
	});
}
```

Rules:
- Actions: docstring starts with `Action:`, descriptive method name
- Verifications: docstring starts with `Verify:`, method named `expect<Thing>()`
- Always wrap body in `test.step()` with a readable label
- Use `@param` tags for each parameter
- Use scoped locators (container-first) to avoid ambiguity
- Return `Promise<void>`

## POM Health

**REQUIRED whenever ANY of these occurred during the test run:**
- A retry used a different POM method than the first attempt
- A raw Playwright action (`clickRole`, `clickText`, `clickSelector`, `waitForSelector`,
  `evaluate`, `snapshot`) was used for something a POM method SHOULD cover
- A POM method failed due to ambiguous matching (strict mode violation)

**If none of these occurred, skip this section.** But if ANY did, you MUST include it --
even if the test ultimately passed. A passing test that used a raw workaround is a
POM gap that should be fixed.

**Method Confusion** (retried with a different POM method that succeeded):
- CONFUSION: Called `<original>` (failed), retried with `<replacement>` (passed).
  JSDoc on original: <present/missing>. JSDoc on replacement: <present/missing>.
  Recommendation: <Add @see cross-references / Update JSDoc to clarify distinction>

**POM Gap** (fell back to raw Playwright because no POM method existed):
- GAP: Used raw `<action>` with selector/role `<details>` because no POM method covers <intent>.
  Suggested POM: <pom>.ts
  Suggested method: `<methodName>(<params>): Promise<void>`

## Backlog Auto-Append

When a POM Gap is detected, also auto-append it to `test/e2e/tests/_verify/BACKLOG.md`
under `## POM Gaps`:

- [ ] **Missing: <methodName> (<pom>.ts)**
  During QA test "<test title>", no POM method existed for <intent>.
  Used raw `<action>` with `<selector>`.
  Suggested signature: `<methodName>(<params>): Promise<void>`
  Discovered: <date>

## Rough Edges

```
### Rough edges
- [Any UX issues, slow transitions, or unexpected behaviors noticed]
- [Even on passing tests, report anything that felt wrong]
```

## Retry Summary

```
### Retry summary
[REQUIRED if /run-plan was called more than once. Put this at the bottom
of the report so the clean results are visible first.]

**Attempt 1 failed at:** Step N "<title>"
- Error: <error message>
- Root cause: <what was wrong -- wrong expected value, wrong method name, timeout too short, etc.>

**Fix applied:** <what was changed for the retry>

This section MUST appear whenever a retry occurred. Never omit it.
```
