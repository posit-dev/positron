# Developing Positron in the CI dev container

Day-to-day workflow once you're in the **Positron CI (ubuntu24-arm64)** container. (First-time
setup — secrets, license, opening the container — is in [README.md](README.md).)

The common actions (**Positron server**, **Desktop**, **Report**, **Doctor**) are **status-bar
buttons** along the bottom of the window — one click, no Command Palette. Everything else is in
`Cmd-Shift-P → Tasks: Run Task`, prefixed **`Positron CI:`** (type "Positron CI" to filter). The
debugger is in the **Run and Debug** panel.

## The inner loop

1. Start the build watcher **once**: `npm run watch` in the integrated terminal (or Positron's
   native **Positron - Build** task). It recompiles changed files on save — seconds, not minutes.
2. Edit code in VS Code. It's native editing; the files are your host checkout.
3. Re-run or re-debug. **Editing never triggers the ~10-min cold build** — only `npm ci`-level
   changes do (see "When do I need to rebuild?").

## Run tests

- **Test Explorer** (the beaker icon in the sidebar, from the Playwright extension): browse the
  tree, run any test from the gutter ▶, and pick the project from the dropdown. This is the
  easiest way to run one test repeatedly — the CI-repro loop.
- **Terminal:** `npx playwright test --project e2e-electron --grep @:connections`

**Project flavors** (what "project" to pick):

| Project | What it does | Need to start anything? |
|---|---|---|
| `e2e-electron` | self-launches the desktop app (headless) | no — the main CI-repro path |
| `e2e-chromium` | self-starts a web server, runs headed in Chromium (visible via VNC) | no — works out of the box |
| `e2e-server` | connects to an **external** server | yes — run **Positron CI: Start server** first |

## Debug

- **Run and Debug** panel (`Cmd-Shift-D`) → pick **Positron CI: Debug (electron)** → green ▶
  (or `fn-F5`).
- Set a breakpoint by clicking the gutter next to any line in a `.ts` file. A good first one:
  `test/e2e/tests/connections/connections-postgres.test.ts:23` (the first action of the Postgres
  test). Execution pauses there; step with the debug toolbar / `fn-F10`.
- Want to *watch* the app the test drives? Open VNC (below) — the Electron window appears there.

## Explore / play with Positron

- **Browser (smoothest):** **Positron CI: Start server** → open
  `http://localhost:8080/?tkn=dev-token`. Licensed automatically.
- **Desktop Electron app:** **Positron CI: Launch Electron (VNC)** — it renders on the headless
  display and prints a **clickable browser URL**.
- **The desktop is always viewable in your browser** (started by `post-start`): **Cmd-click**
  `http://localhost:6080/vnc.html?autoconnect=true&password=positron` — it opens noVNC in a tab and
  auto-connects, no app or password prompt. The Electron app and any headed `e2e-chromium`/
  `e2e-firefox` browser show up there (fluxbox window manager, so windows are movable).
  **Positron CI: Show VNC connection** re-prints the URL. (Prefer a native viewer? `vnc://localhost:5900`,
  password `positron`.)
- **Inspect a finished test run:** **Positron CI: Show Playwright report** →
  `http://localhost:9323` — the trace viewer gives a frame-by-frame timeline with screenshots and
  DOM snapshots. Usually more useful than watching a fast run live.

## Reproduce a CI failure

1. Check out the failing branch in the container terminal.
2. If `package-lock.json` changed, the build doctor (on start) flags it → **Positron CI: Reinstall
   deps (npm ci)**.
3. Run the same project + grep CI used (e.g. `--project e2e-electron --grep @:connections`). Watch
   via VNC or read the trace; debug with breakpoints. Same image, same DB, same env as CI.

## When do I need to rebuild?

You don't have to guess. The **build doctor** runs on every container start (and as **Positron CI:
Check build status (doctor)**). It compares `package-lock.json` against the last install and checks
for compiled output / Electron / a completed build, then names the task to run:

- deps changed → **Positron CI: Reinstall deps (npm ci)**
- no compiled output → start the watcher (`npm run watch`)
- build incomplete → **Positron CI: Full rebuild (post-create)**

A clean checkout with the watcher running needs nothing.

## Task reference

| Task | What it does |
|---|---|
| **Positron CI: Start server** | issues a license key and serves Positron at `:8080` |
| **Positron CI: Launch Electron (VNC)** | runs the desktop app on the headless display (view via VNC) |
| **Positron CI: Show VNC connection** | ensures VNC is up; prints `vnc://localhost:5900` / password |
| **Positron CI: Show Playwright report** | serves the last run's trace/report at `:9323` |
| **Positron CI: Check build status (doctor)** | reports whether the build is current |
| **Positron CI: Reinstall deps (npm ci)** | after deps change; refreshes the doctor's state |
| **Positron CI: Full rebuild (post-create)** | re-run the whole cold build (idempotent) |
| *Run and Debug →* **Positron CI: Debug (electron)** | run e2e-electron under the debugger |

> Editing **test-infra** files (`test/e2e/infra/…`)? Run **Developer: Reload Window** afterward —
> the Playwright extension caches transpiled infra in a worker and won't pick up changes otherwise.
