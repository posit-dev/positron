# Local Workbench QA (`npm run wb`)

Bring up Workbench + a chosen Positron build in one command.

## Prerequisites
- `docker login ghcr.io` with a PAT (`read:packages` scope)
- `export GITHUB_TOKEN=<pat>` (used for positron-builds + image pulls)
- `gh auth login` (for the Positron release list)
- Docker Desktop: 8+ CPU, 16 GB RAM
- License files: place `workbench.lic` and `connect.lic` in `dockerfiles/`
- `.env`: auto-created from `.env.example` on first run; you'll be prompted for `WB_PASSWORD` if unset

## Usage
- `npm run wb` -- up + pick Positron (last 5 releases or local source) + pick Workbench (stable/daily/custom)
- `npm run wb -- status` -- doctor: containers, versions, URLs
- `npm run wb -- report` -- paste-able environment block for bug reports
- `npm run wb -- overlay` -- rebuild current source + overlay into Workbench (fast inner loop)
- `npm run wb -- test @:workbench` -- run e2e against the live stack
- `npm run wb -- stop` -- pause (volumes preserved); `npm run wb -- down` -- tear down
- Or open `positron.workbench.code-workspace` and use the task buttons.

## First-login "Forbidden"
If `http://localhost:8787` shows Forbidden, clear the `vscode-tkn` cookie for `localhost` and refresh.

## Known limits
- One stack at a time (`container_name: test`). Comparing two WB versions = `down` then bring up the other.
- On Apple Silicon the Connect service runs emulated (amd64) and starts slowly.
