# Local Workbench QA (`npm run wb`)

Bring up Workbench + a chosen Positron build in one command.

## Prerequisites
- `gh auth login` (once) -- include the `read:packages` scope so image pulls
  work: `gh auth refresh -h github.com -s read:packages`. The script derives
  `GITHUB_TOKEN` and the `docker login ghcr.io` from your gh auth automatically;
  exporting `GITHUB_TOKEN` yourself still works and takes precedence.
- Docker Desktop: 8+ CPU, 16 GB RAM
- License files: place `workbench.lic` and `connect.lic` in `dockerfiles/`
- `.env`: auto-created from `.env.example` on first run; you'll be prompted for `WB_PASSWORD` if unset
- Optional: `fzf` for arrow-key version pickers (falls back to a numbered prompt without it)

## Usage
- `npm run wb` -- bring the stack up. On first run (nothing installed) it runs the
  pickers and installs: Positron (Release/Daily channel -> choose a version) and
  Workbench (Release/Daily/Custom; each resolves to the current build, matching the
  workbench-nightly CI). If a combo is already installed it skips the pickers, just
  ensures the stack is running, and prints status -- safe to re-run anytime.
- `npm run wb -- --reinstall` -- force the pickers to run again and reinstall over the
  existing install. Use this to switch to a different Positron/Workbench version.
- `npm run wb -- status` -- doctor: containers, versions, URLs
- `npm run wb -- report` -- paste-able environment block for bug reports
- `npm run wb -- test @:workbench` -- run e2e against the live stack (the `e2e-workbench` Playwright project is already pinned to `@:workbench`, so passing an extra `@:tag` further-narrows within the workbench suite -- it is ANDed, not ORed)
- `npm run wb -- stop` -- pause (volumes preserved); `npm run wb -- down` -- tear down

## First-login "Forbidden"
If `http://localhost:8787` shows Forbidden, clear the `vscode-tkn` cookie for `localhost` and refresh.

## Known limits
- One stack at a time (`container_name: pwb`). Comparing two WB versions = `down` then bring up the other.
- On Apple Silicon the Connect service runs emulated (amd64) and starts slowly.
