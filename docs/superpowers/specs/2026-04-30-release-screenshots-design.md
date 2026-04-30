# Release Screenshots - Design

## Problem

Screenshots on https://positron.posit.co/ are currently produced manually. Each release, someone takes shots of the IDE in known states, edits the docs repo, and opens a PR. This is slow, error-prone, and tends to fall behind the actual UI.

We want a Playwright-based pipeline that produces release-fresh screenshots on demand, named to match the docs site's image paths so a future job can copy them into a docs PR.

## Scope (V1 - Proof of Concept)

V1 builds the framework end-to-end against a small pilot set, on macOS, with manual PR drop-in. Everything else is deferred.

**In scope:**

- New Playwright project, file/folder layout, helpers, output convention.
- 5 pilot screenshot tests covering the easy / medium / full-window difficulty spectrum.
- Local dev workflow (run, inspect output, manually drop into docs repo).

**Pilot pages:**

| File | Shots | Difficulty |
|---|---|---|
| `launch-positron.screenshot.ts` | 1 - clean app at startup | Easy |
| `welcome.screenshot.ts` | 1 - full-window Welcome tab | Full window |
| `variables-pane.screenshot.ts` | 1 - populated Variables pane | Medium |
| `data-explorer.screenshot.ts` | 1-2 - main panel (pre-annotation state) | Medium |
| `filter-bar.screenshot.ts` | 1 - Data Explorer filter bar focused | Medium |

**Deferred to phase 2 (or later):**

- Windows CI runner (we want Windows screenshots for the docs site eventually).
- GitHub Action that opens a PR against the docs repo.
- Coverage of the rest of the docs outline (~30+ pages).
- Annotated screenshots (data-explorer.html-style overlays). Remain manual unless we explicitly revisit.
- Visual regression / snapshot diffing. Worthwhile but a separate concern.

## Architecture

A new Playwright project named `release-screenshots` runs alongside the existing `e2e-electron`, `e2e-windows`, etc. projects defined in `playwright.config.ts`. It uses the same Positron Electron app, the same fixtures, and the same page object models - only the test runner profile differs.

Key isolation mechanisms:

- **Different file extension** (`*.screenshot.ts`) so existing projects can't pick these up via the default `testMatch: '*.test.ts'`, and screenshot files can't accidentally run as regular e2e.
- **Dedicated folder** (`test/e2e/release-screenshots/`) alongside `test/e2e/tests/` and `test/e2e/demos/`. Mirrors the existing convention (e2e tests for behavior, demos for video, release-screenshots for docs).
- **Belt-and-suspenders**: add `'**/release-screenshots/**'` to the `baseIgnore` array in `playwright.config.ts` so existing projects skip the folder regardless of extension.

## File layout

```
test/e2e/release-screenshots/
├── helpers/
│   ├── screenshot-utils.ts     # captureFullWindow(), capturePanel()
│   └── layout-utils.ts         # prepareForScreenshot(), hideToasts(), waitForStableUI()
├── launch-positron.screenshot.ts
├── welcome.screenshot.ts
├── data-explorer.screenshot.ts
├── variables-pane.screenshot.ts
├── filter-bar.screenshot.ts
└── output/                     # gitignored; PNGs land here
```

Test files are flat under `release-screenshots/` (no `pages/` subfolder). Reuse existing POMs from `test/e2e/pages/`.

## Helpers

Two small modules. Add additional helpers only when a real need emerges.

### `screenshot-utils.ts`

The capture primitives:

- `captureFullWindow(page, filename)` - full Electron window screenshot, written to `output/<filename>`.
- `capturePanel(locator, filename)` - bounded screenshot of a single locator (e.g. just the Connections pane). Wraps Playwright's `locator.screenshot()`.
- Resolves the `output/` path internally so test files only pass a filename.

### `layout-utils.ts`

Visual cleanup specific to screenshot capture (not test assertion):

- `prepareForScreenshot(app, page)` - composed cleanup run before any capture: dismiss notifications, hide tooltips, wait for layout to settle. Conceptually the screenshot equivalent of `setupDemoLayout()` in `test/e2e/demos/demo-utils.ts`.
- Smaller helpers (`hideToasts`, `waitForStableUI`, etc.) that `prepareForScreenshot` composes from, callable individually if a specific test needs partial cleanup.

### No new fixtures (yet)

V1 uses the existing `app` and `page` fixtures from `_test.setup.ts`. If specific needs emerge (e.g. a fixture to disable animations, hide cursor, or - if scope is later expanded - add programmatic annotations), we add them then.

## Per-test shape

```ts
test('variables pane - populated', async ({ app, page }) => {
    await app.workbench.variables.openVariablesPane();
    // ...set up interpreter / declare a few variables via existing POMs
    await prepareForScreenshot(app, page);
    await capturePanel(
        page.locator('.variables-pane'),
        'variables-pane.png'
    );
});
```

Flow:

1. Use existing POM methods to navigate and set up world state.
2. Call `prepareForScreenshot(app, page)`.
3. Call `capturePanel(...)` or `captureFullWindow(...)` with the docs-matching filename.

No assertions - a screenshot test "passes" if it finishes without throwing. A failed setup or missing locator throws normally, so we still detect breakage.

## Output and naming

PNGs land in `test/e2e/release-screenshots/output/` (gitignored).

Filenames match the docs site's expected image paths exactly. This is the only contract between this pipeline and the docs repo: when phase 2 lands, PR automation is `cp output/* <docs-repo>/images/`.

```
output/
├── launch-positron.png
├── welcome.png
├── data-explorer.png      # multi-shot pages get suffixes, e.g. data-explorer-summary.png
├── variables-pane.png
└── filter-bar.png
```

Final filenames are determined per-test by inspecting the docs site's current `<img src=...>` for that page.

When authoring a test, look at the corresponding docs page's current `<img src=...>` to determine the exact filename. Match it.

## Dev workflow

1. Author writes / edits a `.screenshot.ts` file.
2. Runs `npx playwright test --project release-screenshots --grep <name>` locally.
3. Inspects the PNG in `output/`.
4. Iterates until the shot looks right.
5. Manually copies the PNG into the docs repo and opens a PR there.

## Configuration changes

`playwright.config.ts`:

- New project entry `release-screenshots` with `testMatch: '*.screenshot.ts'` and `testDir: './test/e2e/release-screenshots'`.
- Add `'**/release-screenshots/**'` to `baseIgnore` so other projects skip the folder.
- Likely no retries (failures are author bugs, not flake to absorb).

`.gitignore`:

- Add `test/e2e/release-screenshots/output/`.

## Out of scope

- Annotated screenshots (data-explorer.html-style arrows / callouts). Remain manual.
- Visual regression / snapshot diffing. Different concern, separate project.
- Cross-platform screenshots in V1. Mac only.
- Cross-theme screenshots (light/dark). Pick one default, expand later.
- Automatic PR to the docs site. Phase 2.

## Open questions for phase 2

- Windows CI runner: existing infra or new?
- Docs repo PR mechanics - does it have a known target branch / labels / reviewers convention we should match?
- How does this hook into the release pipeline - manual workflow_dispatch, or triggered when a release tag promotes?
