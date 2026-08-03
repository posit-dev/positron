---
name: positron-web
description: "Run Positron as a web server (code-server) and drive it in the in-app browser - screenshots, DOM, console, network. Requires a Posit-internal license key. Use when you specifically need the web build (web-only bugs, browser-only behavior, or the browser tooling); for ordinary UI verification prefer the positron-launch skill, which drives the real Electron app and needs no license."
---

# Positron Web for browser automation

Serves the workbench over HTTP so the in-app browser tools (`preview_start`,
`navigate`, `computer`, `read_page`, `read_console_messages`,
`read_network_requests`) can drive it.

## Read this first: you need a license key

**Positron Web will not serve without a signed license token.** It exits during
startup with a single log line:

> No license key provided. A signed license token is required to use Positron in
> a hosted environment.

There is **no dev bypass** - `src/vs/server/node/remoteLicenseKey.ts` has no
`isDev` / `NODE_ENV` escape. CI supplies it from the `POSITRON_LICENSE` secret
(see `.github/workflows/test-e2e-jupyter-ubuntu.yml`). It is Posit-internal, so
external contributors cannot run this path at all.

Supply it one of these ways, then `start-web.sh` will proceed:

```bash
export POSITRON_LICENSE_KEY=<key>          # or POSITRON_LICENSE_KEY_FILE=<path>
# or: start-web.sh --license-key <key> / --license-key-file <path>
```

Without one, `start-web.sh` fails immediately with exit 2 rather than waiting out
the timeout. **This path is unverified end-to-end** - it was blocked here at the
license gate, so treat everything below the license step as untested.

## Prefer the Electron skill

For most UI verification, `.claude/skills/positron-launch` is the better tool: it
drives the real desktop app over CDP, needs no license, and starts in seconds.
Reach for web only when the web build is the point. Web also tells you less:

- **No native dialogs.** `IFileDialogService.showSaveDialog` falls back to the
  quick-input picker, so you can read a proposed filename but not exercise the
  real dialog.
- **Restricted clipboard**, so "Copy Image"-style flows are weak.
- Nothing in the `electron-sandbox` layer is exercised.

## Start it

```bash
.claude/skills/positron-web/scripts/start-web.sh --workspace /tmp/myworkspace
```

Blocks until the server actually responds, then prints one JSON line with `url`,
`port`, `token`, `pid`, `userDataDir` and `logFile`.

**Poll the URL, not the port.** `npm run e2e-start-server` (and `preview_start`)
return as soon as the port binds, which on a cold checkout is minutes before the
server can serve - it first downloads electron, downloads the server node binary
via `gulp node`, and installs the built-in marketplace extensions. That is why
this script exists.

Two things that are *not* problems, both checked:

- **No `compile-web` step is needed.** The transpile daemon already produces
  `out/vs/code/browser/workbench/workbench.js`.
- Several flags in `scripts/e2e-start-server.sh` (`--skip-welcome`,
  `--skip-release-notes`, `--no-cached-data`, `--disable-updates`,
  `--use-inmemory-secretstorage`) are logged as
  `Ignoring option ...: not supported for server`. They're omitted here.

Use `--default-folder` for the workspace (plain `--folder` is deprecated), and
pass a symlink-resolved path - the script does this, since `/tmp` is a symlink to
`/private/tmp` on macOS and an unresolved path is silently ignored.

The user-data-dir defaults under `/tmp` deliberately: the server opens unix
sockets beneath it and macOS caps `sun_path` at 104 bytes.

## Drive it

```
preview_start({ url: "http://localhost:8080" })
navigate to http://localhost:8080/?tkn=dev-token      # token must come from navigate
```

`launch.json` here is a **template**, not read from this directory - copy it to
`<primary-cwd>/.claude/launch.json` and replace `REPO_PATH`. Notes:

- `preview_start` resolves `.claude/launch.json` from the **primary working
  directory**, not a worktree. Put an absolute repo path in `runtimeArgs`.
- The format has no `cwd` field, hence `bash -c "cd REPO_PATH && ..."`.
- A localhost `url` must be bare origin - no path or query - so the `?tkn=` has
  to come from a follow-up `navigate`.
- The `positron-web-attach` entry has a `url` and no command: it attaches to a
  server you already started with `start-web.sh`, which is the combination worth
  using (script for readiness, launch.json for the browser pane).

## Clean up

```bash
kill "$PID"                 # from the JSON
rm -rf "$USER_DATA_DIR"
```
