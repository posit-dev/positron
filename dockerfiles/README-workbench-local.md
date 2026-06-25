# Local Workbench QA (`npm run wb`)

Bring up Workbench + a chosen Positron build in one command.

## Prerequisites
- `docker login ghcr.io` with a PAT (`read:packages` scope)
- `export GITHUB_TOKEN=<pat>` (used for positron-builds + image pulls)
- `gh auth login` (for the Positron release list)
- Docker Desktop: 8+ CPU, 16 GB RAM
- License files: place `workbench.lic` and `connect.lic` in `dockerfiles/`
- `.env`: auto-created from `.env.example` on first run; you'll be prompted for `WB_PASSWORD` if unset
- Optional: `fzf` for arrow-key version pickers (falls back to a numbered prompt without it)

## Usage
- `npm run wb` -- up + pick Positron (last 5 releases) + pick Workbench (stable/daily/custom)
- `npm run wb -- --reinstall` -- re-run the pickers and reinstall (change versions on an existing stack)
- `npm run wb -- status` -- doctor: containers, versions, URLs
- `npm run wb -- report` -- paste-able environment block for bug reports
- `npm run wb -- test @:workbench` -- run e2e against the live stack (the `e2e-workbench` Playwright project is already pinned to `@:workbench`, so passing an extra `@:tag` further-narrows within the workbench suite -- it is ANDed, not ORed)
- `npm run wb -- stop` -- pause (volumes preserved); `npm run wb -- down` -- tear down
- Or open `positron.workbench.code-workspace` and use the task buttons.

## First-login "Forbidden"
If `http://localhost:8787` shows Forbidden, clear the `vscode-tkn` cookie for `localhost` and refresh.

## Known limits
- One stack at a time (`container_name: test`). Comparing two WB versions = `down` then bring up the other.
- On Apple Silicon the Connect service runs emulated (amd64) and starts slowly.
