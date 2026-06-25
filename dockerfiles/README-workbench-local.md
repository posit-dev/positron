# Local Workbench QA (`npm run pwb`)

Run Positron and Posit Workbench together on your machine, against versions you
pick, in one command.

## Prerequisites

- Docker Desktop with 8+ CPUs and 16 GB RAM.
- `workbench.lic` and `connect.lic` in `dockerfiles/`.
- `.env` is created from `.env.example` on first run; you are prompted for
  `WB_PASSWORD` if it is unset.
- Optional: `fzf` for arrow-key pickers (without it you get a numbered prompt).
  Install with `brew install fzf` (macOS), `sudo apt install fzf` (Debian/Ubuntu),
  or `conda install -c conda-forge fzf`.

## Quick start

1. `gh auth login` once (or export a `GITHUB_TOKEN` PAT, which takes
   precedence). Pulling the container images needs the `read:packages` scope,
   but you don't have to figure that out up front: if the token you're using is
   missing it, `npm run pwb` tells you exactly how to add it.
2. Drop `workbench.lic` and `connect.lic` into `dockerfiles/`.
3. `npm run pwb`.

First run asks which Positron and Workbench you want, installs them, and brings
the stack up. Open http://localhost:8787 and log in as `user1`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run pwb` | Bring the stack up. First run: pick versions and install. Already installed: (re)start and show status. Safe to re-run anytime. |
| `npm run pwb -- --reinstall` | Re-run the pickers and reinstall, to switch Positron/Workbench versions. |
| `npm run pwb -- --ttl N` | Set the auto-stop to N minutes; `--no-ttl` disables it. |
| `npm run pwb -- status` | Containers, installed versions, and URLs. |
| `npm run pwb -- logs [svc]` | Tail logs: `rserver` (default), `connect`, or a container name. |
| `npm run pwb -- stop` | Pause the stack (containers stopped, volumes kept). |
| `npm run pwb -- down` | Tear the stack down (removes containers). |

`npm run pwb -- --help` prints the same reference in your terminal.

## Auto-stop

The stack stops itself after 60 minutes so a forgotten one doesn't sit there
burning CPU (you're working in a browser, not the container, so it's easy to
lose track). Each `npm run pwb` resets the timer, and it only stops the instance
it was scheduled for, so a manual restart is never cut short. Change it with
`--ttl N` or turn it off with `--no-ttl` (or set `WB_TTL_MINUTES`).

## Version pickers

- **Positron**: choose Release or Daily, then pick a specific version.
- **Workbench**: Release or Daily (each resolves to the current build, matching
  the workbench-nightly CI), or a custom `.deb` URL to pin a specific build.
  The URL is checked for format, arch, and reachability before install.

## Access

| Service | URL | Login |
| --- | --- | --- |
| Workbench | http://localhost:8787 | `user1` / `WB_PASSWORD` (from `dockerfiles/.env`) |
| Connect | http://localhost:3939 | bootstrapped per run |

## Troubleshooting

- **"Forbidden" on first login**: clear the `vscode-tkn` cookie for `localhost`
  and refresh.
- **One stack at a time** (`container_name: pwb`). To compare two Workbench
  versions, `down` one and bring up the other.
- **Apple Silicon**: the Connect service runs emulated (amd64) and is slow to
  start.
