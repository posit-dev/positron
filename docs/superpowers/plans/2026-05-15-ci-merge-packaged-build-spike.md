# CI Merge Speedup Spike — Linux Packaged Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate end-to-end that we can build Positron on a Linux CI runner via `gulp vscode-linux-x64`, ship the unpackaged app as a smaller artifact, and run the existing e2e test suite against it using the proven `BUILD=<path>` + `getBuildElectronPath` plumbing — before committing to a full pipeline redesign.

**Architecture:** Add one new workflow file (`spike-e2e-linux-built.yml`) with two jobs: a build job that mirrors the relevant parts of `test-e2e-ubuntu-build.yml` but produces a packaged app instead of a workspace tarball, and a test job that mirrors `positron-builds/test-e2e-linux-release.yml`'s install/test pattern but consumes a fresh build artifact instead of a CDN download. Triggered manually via `workflow_dispatch` so it doesn't disturb the merge or PR workflows.

**Tech Stack:** GitHub Actions, gulp (`vscode-linux-x64` task), tar+zstd compression, Playwright e2e tests in `e2e-electron` project, existing `positron-ubuntu24-amd64` container image.

**Reference spec:** `docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-design.md`

---

## File Structure

- Create: `.github/workflows/spike-e2e-linux-built.yml`
- Reference (read-only): `.github/workflows/test-e2e-ubuntu-build.yml` for build container + caching patterns
- Reference (read-only): `posit-dev/positron-builds`'s `test-e2e-linux-release.yml` for the test-against-build pattern
- Reference (read-only): `test/e2e/infra/electron.ts:151` for `getBuildElectronPath` Linux contract (`BUILD=<root>` where root contains `resources/app/product.json` and `<applicationName>` binary)

---

## Task 1: Branch + workflow skeleton

**Files:**
- Create: `.github/workflows/spike-e2e-linux-built.yml`

- [ ] **Step 1: Confirm we're on a feature branch (not main)**

Run: `git branch --show-current`
Expected: a name like `mi/<something>` (not `main`). If on main, run `git checkout -b mi/ci-spike-linux-built` first.

- [ ] **Step 2: Create the spike workflow file with just the trigger and one no-op job**

Create `.github/workflows/spike-e2e-linux-built.yml`:

```yaml
name: "Spike: E2E against packaged Linux build"

on:
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  packages: read

jobs:
  smoke:
    name: spike-smoke
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Confirm workflow runs
        run: echo "Spike workflow is wired up. Replacing this job with the real build next."
```

- [ ] **Step 3: Commit the skeleton**

```bash
git add .github/workflows/spike-e2e-linux-built.yml
git commit -m "spike: scaffold workflow for Linux packaged-build CI experiment"
```

- [ ] **Step 4: Push and trigger once to confirm GitHub picks up the workflow**

```bash
git push -u origin HEAD
gh workflow run spike-e2e-linux-built.yml
```

Wait ~30s, then:

```bash
gh run list --workflow=spike-e2e-linux-built.yml --limit=1
```

Expected: one run, status `in_progress` or `completed` with `success`. If `not found`, the workflow file has a syntax error — fix and recommit.

---

## Task 2: Build job — produce a packaged Linux app

**Files:**
- Modify: `.github/workflows/spike-e2e-linux-built.yml`

- [ ] **Step 1: Replace the smoke job with the build job**

Replace the entire `jobs:` block with:

```yaml
jobs:
  build:
    name: build-linux-packaged
    timeout-minutes: 45
    runs-on: ubuntu-latest-8x
    container:
      image: ghcr.io/posit-dev/positron-ubuntu24-amd64:116
      options: --user 0:0 --init
      credentials:
        username: ${{ secrets.POSITRON_GITHUB_RO_USER }}
        password: ${{ secrets.POSITRON_GITHUB_RO_PAT }}
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      DOCKER_CONFIG: /tmp/.docker
      POSITRON_BUILD_NUMBER: 0
      HOME: /root
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          submodules: recursive

      - name: Ensure Docker config dir is writable
        run: |
          mkdir -p /tmp/.docker
          chmod 700 /tmp/.docker

      - name: Setup build environment
        uses: ./.github/actions/setup-build-env
        with:
          distro: ubuntu
          install-playwright: 'false'
          github-token: ${{ github.token }}

      - name: Run gulp vscode-linux-x64
        id: gulp-build
        env:
          POSITRON_BUILD_NUMBER: 0
        run: |
          START=$(date +%s)
          npm run gulp vscode-linux-x64
          END=$(date +%s)
          ELAPSED=$((END - START))
          echo "gulp_seconds=$ELAPSED" >> $GITHUB_OUTPUT
          echo "gulp_minutes=$((ELAPSED / 60))" >> $GITHUB_OUTPUT

          # Locate the output - gulp writes to /__w/VSCode-linux-x64 (parent of repo)
          if [ -d "/__w/VSCode-linux-x64" ]; then
            echo "build_dir=/__w/VSCode-linux-x64" >> $GITHUB_OUTPUT
          else
            echo "ERROR: VSCode-linux-x64 not found at /__w/"
            find /__w -maxdepth 3 -type d -name 'VSCode-linux*' || true
            exit 1
          fi

      - name: Verify packaged app structure
        run: |
          BUILD_DIR="${{ steps.gulp-build.outputs.build_dir }}"
          echo "=== Listing $BUILD_DIR (depth 2) ==="
          find "$BUILD_DIR" -maxdepth 2 -type f -name 'product.json' -o -name 'package.json' | head -10
          echo "=== Expected: resources/app/product.json ==="
          test -f "$BUILD_DIR/resources/app/product.json" || { echo "MISSING: resources/app/product.json"; exit 1; }
          APP_NAME=$(node -e "console.log(require('$BUILD_DIR/resources/app/product.json').applicationName)")
          echo "applicationName=$APP_NAME"
          test -f "$BUILD_DIR/$APP_NAME" || { echo "MISSING: binary at $BUILD_DIR/$APP_NAME"; exit 1; }
          echo "✓ Packaged app verified at $BUILD_DIR"

      - name: Compress artifact
        id: compress
        run: |
          BUILD_DIR="${{ steps.gulp-build.outputs.build_dir }}"
          mkdir -p /tmp/artifacts
          START=$(date +%s)
          tar -C "$(dirname "$BUILD_DIR")" \
              --use-compress-program='zstd -T0 -1' \
              -cf /tmp/artifacts/positron-linux-x64.tar.zst \
              "$(basename "$BUILD_DIR")"
          END=$(date +%s)
          SIZE_MB=$(du -m /tmp/artifacts/positron-linux-x64.tar.zst | cut -f1)
          echo "tar_seconds=$((END - START))" >> $GITHUB_OUTPUT
          echo "artifact_mb=$SIZE_MB" >> $GITHUB_OUTPUT
          echo "Artifact: ${SIZE_MB} MB, compressed in $((END - START))s"

      - name: Upload artifact
        uses: actions/upload-artifact@v7
        with:
          name: positron-linux-x64-packaged
          path: /tmp/artifacts/positron-linux-x64.tar.zst
          retention-days: 1
          compression-level: 0

      - name: Report metrics to summary
        run: |
          cat >> $GITHUB_STEP_SUMMARY <<EOF
          ## Spike build metrics
          - gulp vscode-linux-x64: **${{ steps.gulp-build.outputs.gulp_minutes }} min** (${{ steps.gulp-build.outputs.gulp_seconds }}s)
          - Artifact size: **${{ steps.compress.outputs.artifact_mb }} MB**
          - tar+zstd time: ${{ steps.compress.outputs.tar_seconds }}s
          EOF
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/spike-e2e-linux-built.yml
git commit -m "spike: add build job producing vscode-linux-x64 artifact"
git push
```

- [ ] **Step 3: Trigger and watch**

```bash
gh workflow run spike-e2e-linux-built.yml
sleep 10
RUN_ID=$(gh run list --workflow=spike-e2e-linux-built.yml --limit=1 --json databaseId --jq '.[0].databaseId')
echo "Run ID: $RUN_ID"
gh run watch $RUN_ID
```

Expected: build job succeeds within ~25-35 min. The job summary should report gulp time and artifact size.

- [ ] **Step 4: Capture and record build metrics**

```bash
gh run view $RUN_ID --log | grep -E "Spike build metrics|gulp vscode|Artifact size|tar\+zstd" -A1 | head -20
```

Record the values:
- `gulp vscode-linux-x64` minutes: ___
- Artifact size MB: ___

**Decision gate:** If build > 45 min OR artifact > 1500 MB, pause and reassess before proceeding. Otherwise continue.

- [ ] **Step 5: If build job failed, diagnose before adding the test job**

Common failure modes and fixes:
- `Cannot find module gulp` → `setup-build-env` didn't install root deps; verify `install-playwright: 'false'` didn't accidentally skip core deps. Check the action's behavior with `cat .github/actions/setup-build-env/action.yml`.
- `vscode-linux-x64 task not found` → confirm the task name with `npm exec -- gulp --tasks 2>&1 | grep vscode-linux`.
- `VSCode-linux-x64 not found at /__w/` → output is somewhere else. Add a `find /__w -maxdepth 4 -type d -name 'VSCode*'` to the verification step and re-run.

---

## Task 3: Test job — run e2e against the packaged build

**Files:**
- Modify: `.github/workflows/spike-e2e-linux-built.yml`

- [ ] **Step 1: Add the test job after the build job**

Append after the `build:` job (same indentation level, inside `jobs:`):

```yaml
  test:
    name: test-against-packaged-build
    needs: [build]
    timeout-minutes: 90
    runs-on: ubuntu-latest-8x
    container:
      image: ghcr.io/posit-dev/positron-ubuntu24-amd64:116
      options: --user 0:0 --init
      credentials:
        username: ${{ secrets.POSITRON_GITHUB_RO_USER }}
        password: ${{ secrets.POSITRON_GITHUB_RO_PAT }}
    services:
      postgres:
        image: ghcr.io/posit-dev/positron-postgres-ubuntu24-amd64:116
        credentials:
          username: ${{ secrets.POSITRON_GITHUB_RO_USER }}
          password: ${{ secrets.POSITRON_GITHUB_RO_PAT }}
        ports:
          - 5432:5432
        env:
          POSTGRES_USER: ${{ secrets.E2E_POSTGRES_USER }}
          POSTGRES_PASSWORD: ${{ secrets.E2E_POSTGRES_PASSWORD }}
          POSTGRES_DB: ${{ secrets.E2E_POSTGRES_DB }}
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      DOCKER_CONFIG: /tmp/.docker
      POSITRON_BUILD_NUMBER: 0
      HOME: /root
      _R_CHECK_FUTURE_FILE_TIMESTAMPS_: false
      _R_CHECK_CRAN_INCOMING_: false
      _R_CHECK_SYSTEM_CLOCK_: false
      AWS_S3_BUCKET: positron-test-reports
      E2E_POSTGRES_USER: ${{ secrets.E2E_POSTGRES_USER }}
      E2E_POSTGRES_PASSWORD: ${{ secrets.E2E_POSTGRES_PASSWORD }}
      E2E_POSTGRES_DB: ${{ secrets.E2E_POSTGRES_DB }}
      R_LIBS_SITE: /usr/local/lib/R/site-library
      R_LIBS_USER: /usr/local/lib/R/site-library
      RETICULATE_PYTHON: /root/.venv/bin/python
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          submodules: recursive

      - name: Setup AWS S3 Access
        uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.QA_AWS_RO_ROLE }}
          aws-region: ${{ secrets.QA_AWS_REGION }}

      - name: Load secret
        uses: 1password/load-secrets-action@v4
        with:
          export-env: true
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
          ANTHROPIC_KEY: "op://Positron/Anthropic/credential"
          OPENAI_KEY: "op://Positron/OpenAI/credential"
          POSIT_AUTH_HOST: "op://Positron/Posit-AI-Login/website"
          POSIT_EMAIL: "op://Positron/Posit-AI-Login/username"
          POSIT_PASSWORD: "op://Positron/Posit-AI-Login/password"

      - name: Download packaged build
        id: download
        uses: actions/download-artifact@v8
        with:
          name: positron-linux-x64-packaged
          path: /tmp/artifacts

      - name: Extract packaged build
        id: extract
        run: |
          START=$(date +%s)
          mkdir -p /opt/positron-build
          zstd -d -T0 --stdout /tmp/artifacts/positron-linux-x64.tar.zst | \
            tar --no-same-owner --no-same-permissions -x -C /opt/positron-build
          END=$(date +%s)
          BUILD_PATH="/opt/positron-build/VSCode-linux-x64"
          test -d "$BUILD_PATH" || { echo "MISSING $BUILD_PATH"; ls /opt/positron-build; exit 1; }
          test -f "$BUILD_PATH/resources/app/product.json" || { echo "MISSING product.json"; exit 1; }
          echo "build_path=$BUILD_PATH" >> $GITHUB_OUTPUT
          echo "extract_seconds=$((END - START))" >> $GITHUB_OUTPUT
          echo "✓ Extracted in $((END - START))s to $BUILD_PATH"

      - name: Install E2E test dependencies
        run: npm --prefix test/e2e ci --prefer-offline --no-audit --no-fund

      - name: Install Playwright browsers
        env:
          PLAYWRIGHT_BROWSERS_PATH: .playwright-browsers
        run: npx playwright install chromium

      - name: Setup E2E Test Environment
        uses: ./.github/actions/setup-test-env
        with:
          aws-role-to-assume: ${{ secrets.QA_AWS_RO_ROLE }}
          aws-region: ${{ secrets.QA_AWS_REGION }}

      - name: Alter AppArmor Restrictions for Playwright
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true

      - name: Set Report URL
        uses: ./.github/actions/gen-report-dir
        with:
          identifier: spike-e2e-linux-built
          skip-summary: true

      - name: Run e2e (@:critical) against packaged build
        id: run-tests
        env:
          POSITRON_PY_VER_SEL: "3.10.12"
          POSITRON_R_VER_SEL: 4.5.2
          POSITRON_PY_ALT_VER_SEL: "3.13.0"
          POSITRON_R_ALT_VER_SEL: 4.4.2
          POSITRON_HIDDEN_PY: "3.12.10 (Conda)"
          POSITRON_HIDDEN_R: 4.4.1
          PWTEST_BLOB_DO_NOT_REMOVE: 1
          CONNECT_API_KEY: ${{ secrets.CONNECT_API_KEY }}
          USE_KEY: true
          BUILD: ${{ steps.extract.outputs.build_path }}
          PW_JSON_FILE: test-results/spike.json
        run: |
          START=$(date +%s)
          # First run bootstrap-extensions once (clones QA content + warms extensions)
          BUILD="$BUILD" npx playwright test \
            test/e2e/tests/extensions/bootstrap-extensions.test.ts \
            --project e2e-electron --reporter=null || true

          # Now run the @:critical slice with the same BUILD env
          BUILD="$BUILD" SKIP_BOOTSTRAP=true SKIP_CLONE=true npx playwright test \
            --project e2e-electron \
            --workers 2 \
            --grep "@:critical" \
            --max-failures 10 \
            --reporter=json || true
          END=$(date +%s)
          echo "test_seconds=$((END - START))" >> $GITHUB_OUTPUT

      - name: Summarize results
        if: always()
        run: |
          PASS_COUNT=$(jq '[.suites[]?.specs[]?.tests[]? | select(.results[0].status == "passed")] | length' test-results/spike.json 2>/dev/null || echo 0)
          FAIL_COUNT=$(jq '[.suites[]?.specs[]?.tests[]? | select(.results[0].status == "failed")] | length' test-results/spike.json 2>/dev/null || echo 0)
          SKIP_COUNT=$(jq '[.suites[]?.specs[]?.tests[]? | select(.results[0].status == "skipped")] | length' test-results/spike.json 2>/dev/null || echo 0)
          cat >> $GITHUB_STEP_SUMMARY <<EOF
          ## Spike test metrics
          - Extract time: ${{ steps.extract.outputs.extract_seconds }}s
          - Total test time: $(( ${{ steps.run-tests.outputs.test_seconds }} / 60 )) min (${{ steps.run-tests.outputs.test_seconds }}s)
          - **Passed: $PASS_COUNT**
          - **Failed: $FAIL_COUNT**
          - Skipped: $SKIP_COUNT
          EOF

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: spike-test-results
          path: test-results/spike.json
          if-no-files-found: ignore
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/spike-e2e-linux-built.yml
git commit -m "spike: add test job running e2e against packaged build"
git push
```

- [ ] **Step 3: Trigger and watch**

```bash
gh workflow run spike-e2e-linux-built.yml
sleep 10
RUN_ID=$(gh run list --workflow=spike-e2e-linux-built.yml --limit=1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN_ID
```

Expected: full pipeline (build + test) completes in roughly 60-80 min for the @:critical slice. The job summary should list pass/fail counts.

- [ ] **Step 4: If the test job fails wholesale (not test failures, but workflow setup failures), diagnose**

Common failure modes:
- `BUILD path not found` → extract step put it somewhere else. Check `ls /opt/positron-build` in the failed run.
- `Cannot find Positron at ...` (from `playwrightElectron.ts`) → `BUILD` env wasn't picked up by `test-setup.ts`. Verify by adding `echo "BUILD=$BUILD"` before the playwright invocation.
- `chrome-sandbox: SUID permissions` → the packaged build may need its own SUID fix. Add before tests:
  ```bash
  if [ -f "$BUILD/chrome-sandbox" ]; then
    chown root "$BUILD/chrome-sandbox"
    chmod 4755 "$BUILD/chrome-sandbox"
  fi
  ```
  Document this finding — it's the kind of thing the spike is meant to surface.
- Missing R/Python/Quarto deps → packaged build may not bundle these the same way. The container image has them globally, so test paths should resolve. If a specific test fails for this reason, note it but don't abort the spike.

---

## Task 4: Baseline comparison + findings doc

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-spike-findings.md`

- [ ] **Step 1: Pull the most recent successful `e2e/electron` pass/fail counts from a recent merge run for comparison**

```bash
# Find the most recent green merge run
gh run list --workflow=test-merge.yml --branch=main --status=success --limit=5 \
  --json databaseId,createdAt --jq '.[] | "\(.databaseId) \(.createdAt)"'
```

Pick the most recent successful merge run ID. Then:

```bash
RECENT_RUN_ID=<paste-id-here>
# Find the e2e/electron shard jobs and pull their pass/fail counts from logs
for shard in 1 2; do
  echo "=== electron-$shard ==="
  gh api repos/posit-dev/positron/actions/runs/$RECENT_RUN_ID/jobs --paginate \
    --jq ".jobs[] | select(.name == \"e2e / electron-$shard\") | .steps[] | select(.name == \"🧪 Run Playwright Tests\") | {name, duration: (((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)) / 60 | floor)}"
done
```

Record the baseline pass/fail counts. (You may also need to download the blob report from a recent run for a precise count — `gh run download $RECENT_RUN_ID -n blob-report-e2e-electron-1` then `npx playwright merge-reports --reporter=json blob-report-e2e-electron-1` and `jq` for counts.)

- [ ] **Step 2: Pull the spike's pass/fail counts from the most recent spike run**

```bash
gh run download $RUN_ID -n spike-test-results
jq '[.suites[]?.specs[]?.tests[]? | .results[0].status] | group_by(.) | map({(.[0]): length}) | add' spike.json
```

Expected output: `{"passed": N, "failed": M, "skipped": K}`.

- [ ] **Step 3: Write the findings doc**

Create `docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-spike-findings.md` with this structure (fill in the actual numbers from the spike run):

```markdown
# CI Merge Speedup Spike — Findings

**Date:** <today>
**Spec:** [2026-05-15-ci-merge-packaged-build-design.md](./2026-05-15-ci-merge-packaged-build-design.md)
**Spike workflow:** `.github/workflows/spike-e2e-linux-built.yml`
**Run ID:** <RUN_ID>

## Metrics

| Metric | Spike | Baseline (run <RECENT_RUN_ID>) | Delta |
|---|---|---|---|
| Build job wallclock | __ min | 15 min (build-ubuntu) | __ |
| Artifact size compressed | __ MB | ~multi-GB (workspace tarball) | __ |
| Extract time on test runner | __ s | __ s | __ |
| Test job wallclock | __ min | __ min | __ |
| Total pipeline wallclock | __ min | __ min | __ |
| @:critical tests passed | __ | __ | __ |
| @:critical tests failed | __ | __ | __ |

## Decision

Match against success criteria from the spec:
- [ ] Build job ≤ 35 min: __
- [ ] Artifact ≤ 1 GB compressed: __
- [ ] Test pass rate within 1-2 of baseline: __
- [ ] Combined wallclock < 80 min: __

**Recommendation:** <one of: PROCEED to full design / PROCEED with caveats X, Y / ABORT and pivot to alternative>

## Surprises / new constraints uncovered

- <e.g., SUID sandbox needed manual fix>
- <e.g., test X requires source paths and fails against packaged build>

## Next step

If proceeding: <link to forthcoming full design doc>
If aborting: <link to alternative scope, e.g., unit/ext-host artifact reuse>
```

- [ ] **Step 4: Commit findings**

```bash
git add docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-spike-findings.md
git commit -m "spike: record findings from Linux packaged-build CI experiment"
git push
```

---

## Task 5: Tear down or promote

**Files:**
- Possibly modify: `.github/workflows/spike-e2e-linux-built.yml` (rename, gate, or delete)

- [ ] **Step 1: Decide based on findings**

Review the findings doc. Three outcomes:

1. **Success — proceed to full design.** Keep the spike workflow around as a reference (don't delete). Open a follow-up issue or write the full design doc covering Windows + multi-shard + all consumers (Electron, Chromium, Windows). The spike workflow itself stays as a manual-dispatch reference.

2. **Partial success — proceed with caveats.** Document the caveats in the findings doc. Decide whether they're blockers (e.g., 30% of tests fail in built-mode → blocker; needs test refactoring first) or just complications (e.g., SUID sandbox needs a fixup step → easily addressed in production design).

3. **Failure — abort.** Remove the spike workflow (`git rm .github/workflows/spike-e2e-linux-built.yml`), document why in the findings doc, and pivot to the alternative scope (unit/ext-host artifact reuse + Windows cache hit-rate investigation from the rejected-approaches section of the spec).

- [ ] **Step 2: If aborting, remove the spike workflow**

```bash
git rm .github/workflows/spike-e2e-linux-built.yml
git commit -m "spike: remove Linux packaged-build experiment after evaluation"
git push
```

- [ ] **Step 3: Update spec to reflect outcome**

Open `docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-design.md` and either:
- Update its `Status:` line to `Validated — proceeding to full design` and link to the findings, or
- Update to `Spike failed — see findings; pivoting to alternative` and link to whatever scope replaces it.

```bash
git add docs/superpowers/specs/2026-05-15-ci-merge-packaged-build-design.md
git commit -m "spec: update spike status based on findings"
git push
```

---

## Out of scope for this spike

Reaffirming from the spec — these are explicitly NOT covered:

- Windows packaged-build pipeline (we'll design it after Linux validates)
- Chromium runs against the packaged build (Electron only for the spike)
- All e2e tests (running only `@:critical` for fast iteration)
- Sharding (single-runner test job for the spike)
- Replacing `test-e2e-ubuntu.yml` or any existing production workflow
- Mac e2e coverage
- Unit-tests / ext-host-tests artifact reuse

These get addressed in the follow-up design doc if the spike succeeds.
