/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *---------------------------------------------------------------------------------------------*/

 This will be deleted after successful implementation.


Marimo integration (Phase 1)
=================================

This extension provides Phase 1 Marimo integration for Positron.

Behavior:
- Detects Marimo notebooks as `.py` files containing `import marimo`.
- `positron.marimo.openInViewer` opens the file using `marimo edit <file>` in an integrated terminal (viewer-only; does not execute on open). **Note**: Currently, the user needs to manually click "Open in Viewer" to view the app. Automatic opening in the viewer is not yet implemented.
- `positron.marimo.run` runs `marimo run <file>` in an integrated terminal (explicit run). A matching `positron.marimo.stop` command disposes the terminal to stop the session.

Constraints:
- Uses only the official `marimo` CLI binary available on PATH.
- Does not embed any Marimo runtime, start background servers, or mutate files.
- Uses `--headless` argument to prevent marimo from opening in the browser.
- While copying text from `marimo` works (via `Cmd+C`), copy button functionality does not work.

Error handling:
- CLI detection failures and CLI errors are surfaced via error messages and an output channel. No silent retries are performed.

Configuration:
- `positron.marimo.viewerArgs`: array of extra args passed to `marimo edit` (for example `["--no-token"]` to avoid an access token being required by the viewer).
- `positron.marimo.runArgs`: array of extra args passed to `marimo run`.

Example: in your workspace settings.json

```json
"positron.marimo.viewerArgs": ["--no-token"],
"positron.marimo.runArgs": []
```
