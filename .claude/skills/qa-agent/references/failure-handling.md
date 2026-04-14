# Failure Handling and Retries

If `/run-plan` returns failures:

1. **Read the error and enriched state.** The `state` fields (`variableNames`, `activeSession`, `notifications`, `openTabs`, `focusedPanel`) often reveal the root cause without needing a snapshot.

2. **Classify: infrastructure failure vs. feature-behavior failure.**

   | Signal | Type | Example |
   |--------|------|---------|
   | Action itself failed (selector not found, timeout on click, wrong POM method) | Infrastructure | `contextMenu` step errors with "element not found" |
   | Action succeeded but produced wrong result | **Feature behavior** | `contextMenu` step passed, but clipboard contains `" "` instead of expected text |

   - **Infrastructure:** Fix the test plan (correct method, adjust timeout, add wait step) and retry.
   - **Feature behavior: treat as a potential product bug.** Before retrying with a workaround:
     1. Use `evaluate` to inspect relevant state (e.g., `window.getSelection().toString()` for selection issues, DOM inspection for missing elements)
     2. Flag it as a potential bug in the report **regardless** of whether a workaround makes the test pass
     3. If you work around it, the report must say: "Workaround: X. Original behavior is still a bug because Y."

   **"The test passed but the feature is broken" is a valid and important QA finding.**
   Never dismiss a feature-behavior failure as an "automation artifact" without
   diagnostic evidence that real users would not hit the same issue.

3. **Retry budget: 2 attempts max.** On first failure, analyze the error and correct the plan:
   - Wrong method name or args? Fix from the POM reference.
   - Timeout too short? Increase the per-step `timeout`.
   - Session not ready? Add a wait step or increase session start timeout.

4. **Retry with `resetBefore: true`** to clean up state before re-running:
```bash
curl -s -X POST "http://localhost:$PORT/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "PR 456 (retry)",
    "resetBefore": true,
    "stepTimeout": 5000,
    "steps": [...]
  }'
```

The `resetBefore` flag closes editors, clears console, and restores default layout before running.

5. **If both attempts fail**: you have ONE more option -- switch to Explore Mode
   (see `references/runner-api-explore.md`) for a SINGLE focused investigation
   (e.g., one snapshot + one targeted action). If that doesn't resolve it, **stop
   and report the failure.** Do NOT enter multi-round diagnostic loops. Each
   diagnostic round costs 2-3 minutes and the 20-minute time cap is absolute.

6. **Track divergences for POM Health reporting.** When a retry succeeds with a different
   POM method or a raw Playwright fallback, note the original method, the replacement,
   and whether either had JSDoc in the reference. Report this in Step 4 under POM Health.
