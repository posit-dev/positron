# canvas-lab

A long-lived Positron-hosted Canvas for exploring across many commands (an
agent's tool calls, or a person's shell). `serve` launches Positron once through
`CanvasHarness` (`test/e2e/infra/canvasHarness.ts`), the same profile, assistant
loading, and window monitoring the Canvas e2e spec uses, and keeps it up. Every
other subcommand talks to that server over localhost.

It is not a test: nothing asserts. Use it to try a step, look at windows and
logs, and then encode what you learned in `test/e2e/tests/canvas/`.

## Start

From the repo root, with build daemons running and no debugger attached:

```sh
export CANVAS_ASSISTANT_PATH=/path/to/assistant/packages/positron   # dist/ built
test/e2e/utils/canvas-lab/canvas-lab.sh serve &          # dev-path assistant, IDE on A
# or: CANVAS_ASSISTANT_VSIX=/path/to/assistant.vsix canvas-lab.sh serve --vsix --canvas &
```

`serve` prints the session (fixture folders, profile root, artifacts dir) once
Positron is up. Options: `--vsix`, `--assistant <path>`, `--folder <name|path>`,
`--canvas` (boot into Canvas), `--trust` (workspace trust on, the first folder
trusted), `--folders A,B,C`, `--no-video`, `--trace`, `--keep` (keep the profile
after `stop`). One server at a time; the session lives in
`.build/canvas-lab/session.json`.

## Drive

```sh
L=test/e2e/utils/canvas-lab/canvas-lab.sh
$L run enter                  # positron.canvas.enter
$L run menu                   # workspace menu rows
$L run switch B               # picker; waits for the load and for Canvas to settle
$L run switch C dialog        # "Open existing folder..." + the folder dialog
$L run switch A command       # positron.experimental.switchCanvasFolder
$L windows                    # native windows: id, title, visible, minimized, focused
$L timeline                   # native window timeline since launch, and overlaps
$L shot after-switch          # screenshot every on-screen window
$L eval 'document.title'      # IDE window page; --window <id> for another window
$L eval-canvas 'document.body.innerText.slice(0, 300)'   # Canvas webview document
$L eval-main 'return electron.BrowserWindow.getAllWindows().length'
$L run quit && $L run launch --restore    # graceful quit, relaunch like the Dock does
$L run kill && $L run launch A            # SIGKILL, relaunch on A
$L stop
```

`canvas-lab.sh help` lists every step. Output is JSON on stdout; a failed step
exits non-zero with `{ "error": ... }`.

## Where things are

The artifacts dir (`.build/canvas-lab/runs/<timestamp>/`) holds `harness.log`,
`shots/`, and per launch `launch-N/logs` (main, renderer, extension host and
extension logs, from `--logsPath`), `videos/` (one per window), `trace.zip`
(with `--trace`), `window-timeline.txt`, and `extension-logs/`. The extension
host log appends across folder switches, but an extension's own log channel
(for example `exthost/posit.assistant/Posit Assistant.log`) starts over at each
activation, so the harness copies those channels before every switch.

## Notes

- `stop`, SIGINT, and SIGTERM kill only the process tree this server launched.
- Code changes to the harness need a server restart (`stop`, then `serve`).
