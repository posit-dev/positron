# Mock Positron update feed

A standalone dev tool that serves the `releases.json` documents
`AbstractUpdateService`
(`src/vs/platform/update/electron-main/abstractUpdateService.ts`) fetches, so the
update flow can be exercised from a source build without the real CDN and
without waiting for a release to ship.

It is **not** part of the shipped product -- it is a local Node server.

## What it serves

| Path | What asks for it | Response |
| --- | --- | --- |
| `/positron/<channel>/<platform>/releases.json` | the update check on macOS and Linux | the advertised version as an `IUpdate` document |
| `/positron/<channel>/<platform>/<target>-releases.json` | the update check on Windows, where the file is prefixed with `product.json`'s `target` | same |
| `/positron/<channel>/release-notes/release-<version>.md` | the release notes button in the update tooltip | placeholder markdown |
| `/publish/<version>[/<commit>]` | you, to change what the feed advertises while Positron runs | plain-text confirmation |

Any channel (`releases`, `dailies`) and any platform each update service builds
resolves:

| OS | Platform segment | Feed file |
| --- | --- | --- |
| macOS | `mac/arm64`, `mac/x64` | `releases.json` |
| Linux | `deb/x86_64`, `deb/arm64`, `rpm/...` (`packageType`) | `releases.json` |
| Windows | `win/x86_64`, `win/arm64` | `user-releases.json`, `system-releases.json`, or `undefined-releases.json` in a source build, where `target` is unset |

Snap is absent on purpose: it has no HTTP feed and updates through the snap
store. The `url` in the response gets a plausible per-platform download name
(`.zip`, `.exe`, `.deb`, `.rpm`), though nothing downloads it.

Every response is sent with `Cache-Control: no-store` and no `Last-Modified` or
`ETag`. This matters: the main process fetches the feed through Electron's
`net.request`, which uses Chromium's HTTP cache, and a response carrying only
`Last-Modified` gets heuristic freshness of 10% of its age. Serving the feed as a
plain static file lets an edited feed be replayed from cache, which looks exactly
like the update check finding a version that is no longer being served.

## Setup

Updates are off in a source build for four separate reasons (no `quality`, not
built, an unsigned app the Electron auto-updater refuses, and a dev version newer
than any release). A gitignored `product.overrides.json` at the repo root, merged
over `product.json` when `VSCODE_DEV` is set, turns them on:

```json
{
	"quality": "dev",
	"updateUrl": "http://localhost:8902/positron"
}
```

`quality` is the opt-in: it is empty in the repo's `product.json`, so an unbuilt
Positron only has one if you put it there. That is what `devUpdateTesting` keys
on. Nothing else is required -- `update.positron.channel` already defaults to
`releases`.

By default the feed advertises one build newer than `product.json`
(`positronVersion`-`positronBuildNumber` + 1), so an update is available without
any further configuration. To compare against a different installed version, add
`positronVersion` / `positronBuildNumber` to the overrides, or start the server
with `--version`.

## Running it

```bash
npm run mock-update-server                        # port 8902, one build newer than product.json
npm run mock-update-server -- --port 9000
npm run mock-update-server -- --version 2026.09.0-2 --commit aaaaaaa
```

From VS Code, run the **Mock Update Server** task (Tasks: Run Task) instead.

Then launch Positron from sources with `./scripts/code.sh`. The check runs 30
seconds after startup, or on demand via **Check for Updates**.

## Testing a second update arriving mid-session

This is what makes "Restart to Update" install the version that is latest at
restart time (posit-dev/positron#8284) rather than the one that was pending when
the update was first found.

1. Launch Positron. Within 30s the tooltip reads **Restart to Update** with the
   advertised version.
2. Publish a newer version while it is still running:

   ```bash
   curl localhost:8902/publish/2026.09.0-3/bbbbbbb
   ```

3. Either wait up to 30s for the pending update to re-check the feed, or click
   **Restart to Update**, which re-checks first and postpones the restart when it
   finds something newer. The tooltip passes through **Downloading Newer Update**
   and settles back on **Restart to Update** with the new version.
4. Click **Restart to Update** again. It proceeds this time, and the main log
   records which version the install would have used:

   ```
   update#doQuitAndInstall - dev update testing, would install 2026.09.0-3 2026.09.0-3
   ```

## Limits

A source build is unsigned, so Electron's auto-updater cannot be used at all.
Under `devUpdateTesting` the darwin service simulates the download instead
(`simulateStagedUpdate`), holding each state for a few seconds so the UI is
observable, and `doQuitAndInstall` logs rather than installing. So this exercises
which version the service *selects* and hands over -- not the install itself,
which needs a real signed build.

The overwrite re-check interval is also shortened from 5 minutes to 30 seconds
under `devUpdateTesting`, so each attempt does not take five minutes.

Useful log lines (main channel, `--log debug` for the URLs):

```
update#doReconfigure - update URL is ...
update#checkForUpdates, <version> is available
update#checkForOverwriteUpdates ... newer update available, restarting update machinery
update#checkForOverwriteDownload - newer update confirmed
update#simulateStagedUpdate - dev update testing, staging update without downloading it
```
