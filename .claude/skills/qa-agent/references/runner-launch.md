# Runner Launch Commands

## Launching the Explore Runner

Launch the Playwright test in the background. **Always** set `EXPLORE_TITLE` to a short, descriptive name (PR number + brief summary).

**For Electron (default -- local dev):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
EXPLORE_TITLE="PR 456: Ctrl+C in .qmd with inline output" npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &
```

**For Electron (built app -- macOS):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
BUILD=/Applications/Positron.app EXPLORE_TITLE="PR 456: Ctrl+C in .qmd with inline output" npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &
```

**For browser mode (Firefox, Chromium, WebKit):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
ALLOW_EXPLORE=1 EXPLORE_TITLE="PR 789: Plots new window broken in Firefox" npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-firefox 2>&1 &
```
Note: `ALLOW_EXPLORE=1` is required for browser projects -- it removes the explore directory from testIgnore.

**Important:** Never use just the PR number. Always include a brief summary (under 60 chars).

## Readiness

The runner writes `/tmp/explore-runner-port` when ready. It takes ~30-60s to boot.
With the parallel launch pattern, the runner has a 30-40s head start by the time
you need it -- it's almost always ready. Skip the poll loop and go straight to
`/describe`. If the port file doesn't exist, retry once after 5s.

**While the runner starts**, generate the POM reference if it was missing (this fills dead time):
```bash
npx tsx scripts/generate-pom-reference.ts &
```

## POM Reference Staleness Check

**Generate POM reference if missing or stale:**
```bash
# Regenerate if missing OR if any POM source file is newer than the reference
REF=test/e2e/tests/_generated/pom-reference.md
if [ ! -f "$REF" ] || [ -n "$(find test/e2e/pages -name '*.ts' -newer "$REF" 2>/dev/null | head -1)" ]; then
  npx tsx scripts/generate-pom-reference.ts
fi
```

**Read the POM reference** to get exact method names, parameter types, and available POMs:
```bash
Read test/e2e/tests/_generated/pom-reference.md
```

Use the reference to pick exact method names and parameter types for every POM step. **NEVER guess method names or parameter types** -- always consult the reference first.
