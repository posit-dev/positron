# Canvas e2e

End-to-end tests for Positron-hosted Canvas (Posit Assistant's Canvas UI in
desktop Positron): booting into Canvas, switching its folder, the switch's
refusals, and relaunching into Canvas. Tagged `@:canvas`, Electron only.

## Run

Needs a Canvas-capable Posit Assistant (one with the Canvas workspace picker).
Tests skip when none is configured.

```sh
export CANVAS_ASSISTANT_PATH=/path/to/assistant/packages/positron   # dist/ built: dev-path mode
export CANVAS_ASSISTANT_VSIX=/path/to/assistant.vsix                # the relaunch tests need this
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE \
  npx playwright test test/e2e/tests/canvas --project e2e-electron --workers 1
```

With both set, most tests use the dev path (`CANVAS_ASSISTANT=vsix` to prefer
the VSIX). The relaunch tests always use the VSIX: a window running with
`--extensionDevelopmentPath` does not restore the last session's windows and has
no hot-exit backups. Set `CANVAS_KEEP_PROFILE=1` to keep each test's profile
and fixture folders; a failing test keeps them anyway and names the path in
its annotations.

Run it with no debugger attached (F5 holds new windows paused and wedges
React), and do not rely on the machine's own Positron state: each test gets a
fresh `CanvasHarness` profile.

## What a test gets

`CanvasHarness` (`test/e2e/infra/canvasHarness.ts`) owns one profile per test:

- user data, extensions, and `--shared-data-dir` under a short temp dir, so
  recents, workspace trust, and secrets do not come from (or leak into) the
  machine's `~/.positron-shared`
- fixture folders `A`, `B`, `C` (plus optional symlink aliases), seeded as the
  recent folders
- the e2e default settings plus `assistant.experimentalFeatures` and no
  extension auto-update, so the gallery cannot replace the assistant under test
- the assistant by `--extensionDevelopmentPath` or installed from the VSIX
  into the profile's extensions dir
- `--disable-renderer-backgrounding --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows`, since Canvas hides the IDE window
- workspace trust off unless the test asks for it

It launches, quits (like the Quit menu item), kills (SIGKILL of the process
tree it launched), and relaunches on the same profile, and records every
native window's visibility in the main process. `expectNoFlash` fails a test
when two windows stay on screen together longer than a hand-off.

The `Canvas` page object (`test/e2e/pages/canvas.ts`) finds the Canvas window,
reaches into its webview, and drives the workspace menu by the assistant's
test ids.

## Artifacts

Each test's output dir (`test-results/<test>/canvas/`) holds a screenshot of
every on-screen window after each step, a video per window, a Playwright
trace, the native window timeline, the app's logs (`launch-N/logs`, including
extension host and extension logs), and extension log snapshots taken before
each switch. Screenshots, videos, traces, and timelines are also attached to
the report.

## Not covered

- Chat after a switch (`test.fixme`): Positron-hosted Canvas has no mock
  model provider.
- The native folder dialog: under `--enable-smoke-test-driver` the workbench
  always shows its simple file dialog instead (fileDialogService.ts), so
  "Open existing folder..." is driven through that quick input.
- A locked or sleeping display.

To explore interactively, see `test/e2e/utils/canvas-lab/README.md`.
