# Merge CI Speedup via Packaged-Build Artifacts

**Date:** 2026-05-15
**Status:** Spike plan — full design pending spike results
**Scope:** `test-merge.yml` only (PR workflow out of scope for this round)

## Problem

`test-merge.yml` runs ~95-105 min wallclock per merge to main. Per-job timing across the last 5 successful merges:

| Job | Wallclock | On critical path? |
|---|---|---|
| e2e/windows (3 shards) | 84-108 min | Yes (independent) |
| setup/build-ubuntu → e2e/electron (2 shards) | 96-99 min | Yes |
| setup/build-ubuntu → e2e/chromium (2 shards) | 78-80 min | No |
| ext-host-tests | 30-36 min | No |
| unit-tests | 21-29 min | No |

Two parallel paths gate the merge: Windows (~95 min) and build → Electron (~96 min). They're co-equal, so any single-path optimization only helps if the other path also drops.

The biggest single time sinks within those paths:
- Windows: `Install node dependencies` step takes 16-31 min per shard (varies by cache hit rate)
- Electron shard: 73 min of pure Playwright test execution (build/run already split for Ubuntu)
- Each of `unit-tests` and `ext-host-tests` re-compiles Positron from scratch

## Constraints

1. **Balanced goals:** Optimize both wallclock and runner-minute cost. Avoid changes that buy wallclock at 2× runner cost.
2. **Windows stays per-merge:** Cannot move Windows off the merge critical path (e.g., to nightly).
3. **Shard counts stay roughly steady:** No "throw more runners at it" lever.

## Rejected approaches

### Windows build/run split via dev-workspace tarball (already tried, abandoned)

In December 2025, three branches (`mi/windows-dream`, `mi/windows-dream-2`, `mi/windows-dream-ii`) attempted to build Positron once on a Windows runner and share the dev workspace as an artifact to 3 Windows shard runners. Two variants:

- **Windows-built workspace tarball:** Artifact was multi-GB. Compression experiments (gzip → pigz → 7z → zstd) didn't compensate; Windows runner downloads remained too slow to recover wallclock.
- **Linux-built artifact for Windows shards:** Hit native module incompatibility (`.node` files are platform-specific) and `node_modules/.bin` symlink extraction failures on Windows. Rebuilding native modules on Windows re-introduced most of the install time the split was trying to save.

Final commit on that effort: `8d67c38054` ("oh i give up").

**Why this design doesn't repeat that failure:** The packaged-build artifact is the installer or app bundle (~300-500 MB estimated), not a multi-GB dev workspace. Smaller artifact + same platform build/install path = the Windows download bottleneck is structurally avoided.

## Proposed approach: package once per platform, test against the packaged build

Apply the pattern already used in `posit-dev/positron-builds` for QA-testing release artifacts (`test-e2e-linux-release.yml`, `test-e2e-windows-release.yml`):

1. Build Positron once per platform via `gulp vscode-<platform>-<arch>` to produce a packaged app (`Positron.app` on Mac, `VSCode-linux-x64/` on Linux, `.exe` installer on Windows).
2. Upload the packaged artifact (much smaller than a dev workspace).
3. Test shards download + extract/install + run tests against the packaged app via the existing `BUILD` env / `getBuildElectronPath` plumbing.

### Why this is feasible

- **Gulp targets already exist for all platforms.** `vscode-darwin-arm64` (used by `/dmg`), `vscode-linux-x64`, `vscode-win32-x64` are dynamically defined in `build/gulpfile.vscode.ts:847`.
- **Playwright e2e infrastructure already supports built-mode.** `test/e2e/infra/electron.ts` exports `getBuildElectronPath(root)` with platform-specific path handling; `test/e2e/infra/test-runner/test-setup.ts` switches modes based on whether `testCodePath` (driven by `BUILD` env) is set.
- **The pattern is in production.** `positron-builds`' release-test workflows have been running this exact pattern against signed release builds for QA. The full e2e suite passes against installed/extracted builds today.

### Estimated impact

| Path | Today | After |
|---|---|---|
| Windows critical path | ~95 min | ~75 min (build ~30 + run ~45) |
| Build → Electron critical path | ~96 min | ~70 min (build ~20 + run ~50) |
| Per-shard runner time | ~50 min setup + tests | ~5 min extract/install + tests |

Net wallclock: **~75-80 min critical path (~15-20 min saved).**
Net compute: **~200+ runner-min saved per merge** (7 shards × ~30 min compile avoided, partially offset by 2 dedicated build jobs).

## Open questions (spike must answer)

1. **What's the real build time for `gulp vscode-linux-x64` on our Ubuntu CI runner?** `/dmg` measures 12-25 min on Mac; Linux/Windows packaging time on our CI runners is unknown.
2. **Does our existing e2e suite pass against a packaged Linux build with no test changes?** `positron-builds` does this for release builds; we need to verify our current `main` test suite works the same way against a fresh-from-source build.
3. **What's the actual artifact size?** Determines download/extract time per shard.
4. **Are there any tests that fail in built-mode but pass in dev-mode?** (source maps, in-tree paths, dev-only feature flags)

## Spike plan

**Scope:** Linux only. If Linux works, Windows almost certainly works (same `BUILD` pattern, `positron-builds` has a proven Windows variant).

**Branch:** `mi/<descriptive-name>` off `main`.

**Steps:**

1. Add a new workflow `spike-e2e-linux-built.yml` that runs only on `workflow_dispatch`.
2. Job 1 (`build-positron-linux`):
   - Use the existing `positron-ubuntu24-amd64` container.
   - Reuse `setup-build-env` action through the npm-install step.
   - Run `npm run gulp vscode-linux-x64`.
   - Upload `../VSCode-linux-x64/` as an artifact (tar+zstd for speed).
3. Job 2 (`test-e2e-linux-built`), depends on Job 1:
   - Mirror `positron-builds`' `test-e2e-linux-release.yml` install/setup pattern.
   - Download Job 1's artifact instead of pulling from CDN.
   - Extract to a known path.
   - Set `BUILD=<extracted-path>`.
   - Run `npx playwright test --project e2e-electron --workers 2 --grep @:critical`.
4. Capture metrics:
   - Build job wallclock + artifact size
   - Test job wallclock + pass/fail count
   - Compare to current `main` e2e-electron critical-tag run

**Success criteria:**
- Build job completes in ≤ 35 min (acceptable trade for the per-shard savings)
- Artifact ≤ 1 GB compressed
- Test pass rate matches current main within noise (≤ 1-2 test delta)
- Combined wallclock < 80 min for the slice that runs

**If spike succeeds:** Promote findings into a full design doc covering all three Ubuntu/Windows/Chromium consumers, then write an implementation plan.

**If spike fails:** Document the failure mode (test incompatibility, slow build, oversized artifact) and either (a) scope a fix as a precondition or (b) abandon this approach and revert to the smaller-scoped optimizations (unit/ext-host artifact reuse, Windows cache hit-rate investigation).

## Out of scope for this round

- Mac e2e coverage (currently absent — packaged-build pipeline would enable it, but not pursued now).
- `test-pull-request.yml` optimizations.
- `unit-tests` and `ext-host-tests` artifact reuse (orthogonal; deferred to a follow-up).
- Pre-baking R/Python/Quarto into the Windows runner image.
- Self-hosted runner investments.

## References

- Prior failed attempt: branches `mi/windows-dream`, `mi/windows-dream-2`, `mi/windows-dream-ii`; final commit `8d67c38054`.
- Production reference workflows: `posit-dev/positron-builds/.github/workflows/test-e2e-linux-release.yml`, `test-e2e-windows-release.yml`.
- Playwright built-mode plumbing: `test/e2e/infra/electron.ts:151` (`getBuildElectronPath`).
- Gulp packaging task generator: `build/gulpfile.vscode.ts:847`.
- `/dmg` PR-comment build: `.github/workflows/pr-build-dmg.yml`.
