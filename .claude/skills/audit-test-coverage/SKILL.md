---
name: audit-test-coverage
description: Use to audit test coverage for a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. Triggers include "audit coverage for <feature>", "is my test placement right", "quality-check before merge", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of pre-PR review. Produces a cross-bucket test coverage audit (Core Mocha / Vitest / Extension host / E2E) with explicit verdicts (Keep / Move down / Move up / Split / Add / Delete / Skip) and confidence per item. Optionally orchestrates handoff to author-vitest-tests and author-e2e-tests.
---

# Audit Test Coverage (Positron)

Audit a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. The report is the deliverable. Bias hard against E2E: push coverage down the pyramid unless the test genuinely needs the full app. Hand off to the right author-* skill only if the dev opts in.
