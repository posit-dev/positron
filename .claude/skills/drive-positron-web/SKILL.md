---
name: drive-positron-web
description: "Start Positron Web from source and control it with browser automation or @playwright/cli. Use for web-only bugs, browser-specific behavior, accessibility-tree inspection, console or network diagnostics, and changes that specifically require the web workbench. Requires access to the Posit-internal license issuer or an explicit signed license key. Prefer drive-positron for ordinary desktop UI verification."
---

# Drive Positron Web

Use this skill only when the web build is relevant to the behavior under test. For ordinary UI verification, use `.claude/skills/drive-positron`: it exercises the Electron application, starts without a web license, and covers native desktop layers.

Positron Web cannot validate:

- native file dialogs;
- unrestricted clipboard behavior;
- code in the `electron-sandbox` layer.

The web file-dialog service falls back to quick input, which can expose a suggested filename but cannot exercise the native dialog.

## Satisfy the license requirement

Positron Web requires a signed license token. There is no development bypass.

For local development, `scripts/code-server.js` automatically mints a license when it finds a built issuer at:

```text
<repo-parent>/positron-license/pdol/target/debug/pdol
```

Place `positron-license` beside the Positron checkout. For example:

```text
~/posit/positron
~/posit/positron-license
```

A nested worktree changes the expected parent. If the worktree is under
`~/posit/positron.worktrees/`, expose the issuer there:

```bash
ln -s ~/posit/positron-license \
	~/posit/positron.worktrees/positron-license
```

Alternatively, supply a license through one of:

- `--license-key`
- `--license-key-file`
- `POSITRON_LICENSE_KEY`
- `POSITRON_LICENSE_KEY_FILE`

The launcher checks for an issuer or explicit key before starting. This skill is unavailable to external contributors who do not have the internal issuer or a signed key.

## Start the server

Run:

```bash
.claude/skills/drive-positron-web/scripts/start-web.sh \
	--workspace /tmp/myworkspace
```

Wait for one JSON object containing:

- `url`
- `port`
- `token`
- `pid`
- `userDataDir`
- `logFile`

Use the reported values rather than assuming the defaults.

The script waits for an HTTP response. Do not replace this with a port check: code-server binds its port before cold-start downloads and built-in extension installation finish, and an unlicensed server may also bind before exiting.

The script also:

- passes the workspace with `--default-folder`;
- resolves symlinks in the workspace path;
- keeps the user-data directory short enough for macOS Unix sockets;
- omits command-line flags that code-server reports as unsupported.

Do not add a separate `compile-web` step when the normal transpile process has already produced `out/vs/code/browser/workbench/workbench.js`.

The following activation errors can result from stale dependencies and are not inherently web-specific:

- `positron.authentication`: `Cannot find module 'ai-config'`
- `Next Edit Suggestions`, which depends on that extension

Confirm that these match the known dependency condition before ignoring them.

## Select the control method

Use the browser pane when the current desktop environment exposes its browser-automation tools. Use `@playwright/cli` from a terminal when those tools are unavailable.

### Browser pane

Start the server first so readiness is reliable. Then attach with the `positron-web-attach` entry from the included `launch.json` template.

Copy the template to the primary working directory:

```text
<primary-cwd>/.claude/launch.json
```

Replace `REPO_PATH` with the absolute checkout path.

The browser launcher resolves `.claude/launch.json` from the primary working directory, not from a nested worktree. Its format has no `cwd` field, so the template uses `bash -c` to change directories.

A localhost launch URL must contain only the origin. Supply the token with a subsequent navigation:

```text
preview_start({ url: "http://localhost:8080" })
navigate to http://localhost:8080/?tkn=dev-token
computer screenshot
read_page (filter: interactive)
computer left_click ref=<treeitem>
javascript_tool '(() => document.title)()'
```

Use the token reported by `start-web.sh`.

When inspecting the page:

- Use `read_page` with `ref_id` to inspect a subtree if `find` reports that no cached tree exists.
- Click the Explorer's `treeitem` reference rather than its nested link; the useful accessible label belongs to the tree item.
- Use JavaScript evaluation for DOM assertions that the accessibility tree cannot express.

### Terminal CLI

Open the reported URL with a literal session name and reuse it for every command:

```bash
npx @playwright/cli -s=posweb open "$URL"
npx @playwright/cli -s=posweb snapshot
npx @playwright/cli -s=posweb click e153
npx @playwright/cli -s=posweb \
	screenshot --filename="$PWD/shots/01.png"
npx @playwright/cli -s=posweb console
npx @playwright/cli -s=posweb network
npx @playwright/cli -s=posweb \
	eval '(() => document.title)()'
```

Unlike CDP attachment to Electron, `open` requires a browser executable. The default `chrome` channel uses an installed Google Chrome:

```bash
brew install --cask google-chrome
```

Prefer the installed Chrome channel unless the scenario specifically requires a Playwright-managed browser. Managed Chromium, Firefox, and WebKit builds are tied to the CLI's Playwright revision and may require additional downloads after CLI upgrades.

## Clean up

Stop the server using the PID reported by `start-web.sh`:

```bash
kill "$PID"
```

Before removing the user-data directory, verify that it is the exact generated path reported as `userDataDir`:

```bash
case "${USER_DATA_DIR:-}" in
	/tmp/positron-web/*|/private/tmp/positron-web/*)
		rm -rf -- "${USER_DATA_DIR:?}"
		;;
	*)
		echo "Refusing to remove unexpected user-data directory: ${USER_DATA_DIR:-<empty>}" >&2
		exit 1
		;;
esac
```

Inspect `logFile` if the server fails to become ready or exits before cleanup.
