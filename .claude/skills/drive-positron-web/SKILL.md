---
name: drive-positron-web
description: "Run Positron as a web server (code-server) and drive it in a browser - screenshots, DOM, console, network. Requires a Posit-internal license key. Use when you specifically need the web build (web-only bugs, browser-only behavior, or the browser tooling); for ordinary UI verification prefer the drive-positron skill, which drives the real Electron app and needs no license."
---

# Positron Web for browser automation

Serves the workbench over HTTP so a browser automation tool can drive it -
screenshots, accessibility tree, console, network.

## Read this first: the license issuer must be a sibling of the checkout

**Positron Web will not serve without a signed license token**, and there is no
dev bypass (`src/vs/server/node/remoteLicenseKey.ts` has no `isDev`/`NODE_ENV`
escape). It exits during startup with only a log line.

For local development you don't supply a key by hand: `scripts/code-server.js`
**mints one** if it finds a locally built license issuer at

```
<repo-parent>/positron-license/pdol/target/debug/pdol
```

That path is relative to the checkout, so it resolves for `~/posit/positron` but
**not** for a worktree one level deeper (`~/posit/positron.worktrees/<branch>`
looks in `~/posit/positron.worktrees/positron-license`). Symlink it - the same
thing `.devcontainer/ci-arm/post-start.sh` does for CI:

```bash
ln -s ~/posit/positron-license ~/posit/positron.worktrees/positron-license
```

With that in place the server serves in **~6 seconds**, not minutes. If you have
no issuer checkout, pass a key explicitly instead (`--license-key`,
`--license-key-file`, `POSITRON_LICENSE_KEY`, `POSITRON_LICENSE_KEY_FILE`); CI
uses the `POSITRON_LICENSE` secret. `start-web.sh` checks for issuer-or-key up
front and exits 2 with this explanation rather than burning the timeout.

`positron-license` is Posit-internal, so external contributors cannot use this
skill at all.

## Prefer the Electron skill

For most UI verification, `.claude/skills/drive-positron` is the better tool: it
drives the real desktop app over CDP, needs no license, and starts in seconds.
Reach for web only when the web build is the point. Web also tells you less:

- **No native dialogs.** `IFileDialogService.showSaveDialog` falls back to the
  quick-input picker, so you can read a proposed filename but not exercise the
  real dialog.
- **Restricted clipboard**, so "Copy Image"-style flows are weak.
- Nothing in the `electron-sandbox` layer is exercised.

## Start it

```bash
.claude/skills/drive-positron-web/scripts/start-web.sh --workspace /tmp/myworkspace
```

Blocks until the server actually responds, then prints one JSON line with `url`,
`port`, `token`, `pid`, `userDataDir` and `logFile`.

**Poll the URL, not the port.** `npm run e2e-start-server` (and `preview_start`)
return as soon as the port binds, which can be well before the server responds -
a cold checkout first downloads electron, downloads the server node binary via
`gulp node`, and installs the built-in marketplace extensions. That is why this
script exists. Note that an *unlicensed* server also binds the port and then
exits, which looks identical to "still starting" if you only poll the port.

Expect two extension activation errors in the notifications -
`positron.authentication` failing with `Cannot find module 'ai-config'`, and
`Next Edit Suggestions` failing because it depends on it. That's the known stale
`node_modules` issue, not web-specific; ignore it.

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

Which tooling you have depends on where you're running. The browser pane is
**desktop-only** - in the terminal CLI, `preview_start`, `navigate`, `computer`
and `read_page` don't exist. Check which tools you actually have and pick the
matching path.

### Claude Code desktop app (browser pane)

Verified working end to end: serve -> navigate -> screenshot -> read the
accessibility tree -> click -> confirm the result.

```
preview_start({ url: "http://localhost:8080" })
navigate to http://localhost:8080/?tkn=dev-token      # token must come from navigate
computer screenshot
read_page (filter: interactive)                       # then read_page ref_id=<tree> for children
computer left_click ref=<treeitem>
javascript_tool '(() => document.title)()'            # DOM checks
```

Two gotchas found in practice:

- `find` reports "no read_page tree cached" even right after a `read_page`.
  Use `read_page` with `ref_id` to drill into a subtree, or `javascript_tool`
  for DOM queries, instead of relying on `find`.
- Explorer tree items expose the useful `aria-label` on the **treeitem**, not on
  the `link` inside it - click the treeitem ref.

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

### Terminal CLI (no browser pane)

Use `@playwright/cli` - the same tool the `drive-positron` skill uses, pointed at
a URL rather than a CDP endpoint. Same `-s=<name>` session rule applies.

```bash
npx @playwright/cli -s=posweb open "http://localhost:8080/?tkn=dev-token"
npx @playwright/cli -s=posweb snapshot
npx @playwright/cli -s=posweb click e153
npx @playwright/cli -s=posweb screenshot --filename="$PWD/shots/01.png"
npx @playwright/cli -s=posweb console      # replaces read_console_messages
npx @playwright/cli -s=posweb network      # replaces read_network_requests
npx @playwright/cli -s=posweb eval '(() => document.title)()'
```

One setup cost the Electron skill doesn't have: `attach --cdp=...` reuses a
browser that's already running, but `open` needs one of its own. It defaults to
installed Google Chrome, and otherwise wants
`npx @playwright/cli install-browser chrome-for-testing` - a one-time download.
The repo's e2e chromium under `~/Library/Caches/ms-playwright` is **not** reused;
`--browser chromium|firefox|webkit` all ask to install their own build. Only the
install requirement is verified here, not a full drive.

## Clean up

```bash
kill "$PID"                 # from the JSON
rm -rf "$USER_DATA_DIR"
```
