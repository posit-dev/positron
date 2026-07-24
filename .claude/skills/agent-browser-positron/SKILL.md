---
name: agent-browser-positron
description: Use when driving or screenshotting a running Positron dev build with the agent-browser CLI over CDP - especially the Posit Assistant chat panel. Triggers on "screenshot Positron", "screenshot the assistant panel", "drive the running Positron with agent-browser", "automate Positron over CDP", "click in the assistant webview", "capture the running build". Not for polished PR demo videos (see positron-demo-video) or Playwright e2e.
---

# Screenshotting and driving Positron with agent-browser

Positron is an Electron app, so a running dev build exposes a Chrome DevTools
Protocol (CDP) port that the `agent-browser` CLI can connect to. This lets you
drive the live app and capture screenshots to validate a change quickly, without
writing a Playwright test. This is faster than an e2e test but manual; for a
polished recorded walkthrough use `positron-demo-video` instead.

## First: load the tool's own skills

This skill only covers the Positron-specific glue. The generic CLI mechanics
(connect, snapshot, refs, screenshot flags, sessions, troubleshooting) are served
live by the CLI and always match the installed version:

```bash
agent-browser skills get core        # workflows, commands, troubleshooting
agent-browser skills get electron    # launching via --remote-debugging-port, webviews, tabs
```

Read those before running commands. Everything below assumes them.

## 1. Launch Positron with CDP enabled

Positron is NOT an installed app you `open -a`; it is a dev build launched from
the repo. The `--remote-debugging-port` flag must be present at launch (relaunch
if it is already running).

```bash
# Plain Positron dev build
./scripts/code.sh --remote-debugging-port=9222

# Positron with the Posit Assistant extension loaded from a sibling checkout
./scripts/code.sh \
  --extensionDevelopmentPath="$HOME/development/assistant/packages/positron" \
  --user-data-dir="$HOME/.vscode-oss-dev" \
  --remote-debugging-port=9222 \
  --no-cached-data \
  --disable-extension=vscode.vscode-api-tests
```

The build must be compiled first (build daemons running); `code.sh` runs whatever
is in `out/`. Give it a few seconds to open before connecting.

## 2. Connect and list targets

```bash
agent-browser connect 9222
agent-browser tab          # one target: the workbench-dev.html page
```

After `connect`, later commands target the app without `--cdp`.

## 2.5. Open the Posit Assistant panel first

The panel is not always open (it can be replaced by Explorer, Session, etc.). The
activity-bar item IS in the accessibility tree, so open it by ref rather than by
guessing a coordinate. Refs renumber on every snapshot, so snapshot immediately
before clicking:

```bash
agent-browser snapshot -i | grep -i "posit assistant"
# -> tab "Posit Assistant" [ref=eNN]   (or [expanded=true, selected] if already open)
agent-browser click @eNN
```

Confirm it opened: a fresh snapshot shows `heading "POSIT ASSISTANT"` and the
nested `Iframe "Posit Assistant"`. Only then are the chat coordinates in step 5
valid.

## 3. Two interaction zones - they behave differently

This is the key Positron-specific fact.

| Zone | Reachable by `snapshot -i` / `@eN` refs? | How to drive it |
|---|---|---|
| Workbench chrome (activity bar, tabs, buttons, editor, panels) | Yes | `agent-browser snapshot -i` then `agent-browser click @eN` |
| Posit Assistant chat content (input box, messages, Allow/Decline cards) | No | Coordinate clicks + `keyboard type` (see below) |

The assistant chat is a nested webview - the snapshot shows only the iframe
wrappers (`Iframe -> Iframe "Posit Assistant"`), not the inner DOM. So the chat
input, send button, message text, and permission cards have no element refs. Drive
them by coordinate.

## 4. The coordinate gotcha (DPR = 2)

`agent-browser mouse` commands take **CSS pixel** coordinates (the viewport is
1453x858 in a typical window). Screenshots come back at **device pixels** because
Positron runs at `devicePixelRatio: 2`, so a screenshot is 2x the CSS size
(e.g. 2906x1716). Confirm the ratio:

```bash
agent-browser eval "window.devicePixelRatio"   # 2 on retina
agent-browser eval "[window.innerWidth, window.innerHeight]"   # CSS viewport size
```

**Converting a target you see in a screenshot to a click coordinate:**

```
cssX = screenshotPixelX / devicePixelRatio      # e.g. / 2
cssY = screenshotPixelY / devicePixelRatio
```

If your image viewer downscales the screenshot and reports a "multiply by K to
map to original" factor, chain it: `cssX = displayedX * K / devicePixelRatio`.

**More robust than reading pixels:** compute coordinates from the CSS viewport
size and known layout fractions, so it survives resolution changes. The assistant
chat input sits near the bottom-left of the panel; the panel is the left ~30% of
the window:

```bash
# chat input: roughly 17% across, ~70px above the bottom edge
# with a 1453x858 viewport that is about (247, 788)
agent-browser mouse move 247 788
agent-browser mouse down
agent-browser mouse up
```

## 5. Worked example: send a message and screenshot the result

Assumes the Assistant panel is already open (step 2.5) and the window is about
1453x858. If your layout differs, re-derive the input coordinate from a fresh
snapshot/screenshot rather than trusting `247 788`.

```bash
agent-browser connect 9222
mkdir -p "$HOME/Desktop/positron-test"

# focus the chat input (coordinate click - no ref reaches inside the webview)
agent-browser mouse move 247 788; agent-browser mouse down; agent-browser mouse up
agent-browser keyboard type "focus the plots pane"
agent-browser press "Enter"

# the model streams + may show an Allow/Decline permission card; give it time
agent-browser wait 8000
agent-browser screenshot "$HOME/Desktop/positron-test/01-response.png"
```

Then Read the PNG to inspect it. To approve a permission card, screenshot first,
read the Allow button's pixel position, convert with the DPR formula, and click
that coordinate.

## Gotchas

- **Blank assistant panel** usually means `ai-config` was never built (an
  `import 'ai-config/node'` failure breaks the extension host). Fix by installing
  ai-lib deps and building it: `cd ai-lib && npm install` then
  `npm --prefix ai-lib run build -w ai-config`, then let the daemons recompile.
- **Feature gated by a setting** (e.g. the assistant's `positronCommand` tool
  behind `assistant.positronCommandIntegration`): flip it in the dev profile's
  `settings.json` (`~/.vscode-oss-dev/User/settings.json` when using that
  `--user-data-dir`). Most settings are read live; a new chat picks them up.
- **Type into the webview at focus** with `keyboard type` (or `keyboard
  inserttext` to bypass key events). Coordinate-click the input first to focus it.
- **Always `wait` after sending** a chat message - the model streams, and
  permission cards appear a beat later. Screenshot too early and you catch a
  half-rendered turn.
- **Do not commit screenshots** to the repo; write them under a scratch dir
  (`$HOME/Desktop/...` or a tmp dir) and delete when done.
