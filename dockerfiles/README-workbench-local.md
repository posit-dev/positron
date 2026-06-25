# Local Workbench QA (`npm run wb`)

Run Positron and Posit Workbench together on your machine, against versions you
pick, in one command. Built for QA: no more two-terminal dance, no hunting for
the right `.deb` on the download site.

## Quick start

1. `gh auth login` once, with the `read:packages` scope (needed to pull the
   container images): `gh auth refresh -h github.com -s read:packages`.
2. Drop `workbench.lic` and `connect.lic` into `dockerfiles/`.
3. `npm run wb`.

First run asks which Positron and Workbench you want, installs them, and brings
the stack up. Open http://localhost:8787 and log in as `user1`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run wb` | Bring the stack up. First run: pick versions and install. Already installed: (re)start and show status. Safe to re-run anytime. |
| `npm run wb -- --reinstall` | Re-run the pickers and reinstall, to switch Positron/Workbench versions. |
| `npm run wb -- status` | Containers, installed versions, and URLs. |
| `npm run wb -- report` | Paste-able environment block for bug reports. |
| `npm run wb -- logs [svc]` | Tail logs: `rserver` (default), `connect`, or a container name. |
| `npm run wb -- test [grep]` | Run the `e2e-workbench` Playwright suite against `:8787`. |
| `npm run wb -- restart` | Restart rstudio-server inside the container. |
| `npm run wb -- stop` | Pause the stack (containers stopped, volumes kept). |
| `npm run wb -- down` | Tear the stack down (removes containers). |

`npm run wb -- --help` prints the same reference in your terminal.

The `e2e-workbench` project is already pinned to `@:workbench`, so a tag passed
to `test` narrows within that suite (it ANDs, it does not OR). For example,
`npm run wb -- test @:web` runs the web-tagged workbench tests.

## Version pickers

- **Positron**: choose Release or Daily, then pick a specific version.
- **Workbench**: Release or Daily (each resolves to the current build, matching
  the workbench-nightly CI), or a custom `.deb` URL to pin a specific n-1/n-2
  build. The URL is checked for format, arch, and reachability before install.

## Access

| Service | URL | Login |
| --- | --- | --- |
| Workbench | http://localhost:8787 | `user1` / `WB_PASSWORD` (from `dockerfiles/.env`) |
| Connect | http://localhost:3939 | bootstrapped per run |

## Prerequisites

- Docker Desktop with 8+ CPUs and 16 GB RAM.
- `gh auth login` (see Quick start). The script borrows your gh token for
  `GITHUB_TOKEN` and logs Docker into ghcr.io for you. If you would rather
  manage it yourself, an exported `GITHUB_TOKEN` and an existing
  `docker login ghcr.io` both take precedence and are left untouched.
- `workbench.lic` and `connect.lic` in `dockerfiles/`.
- `.env` is created from `.env.example` on first run; you are prompted for
  `WB_PASSWORD` if it is unset.
- Optional: `fzf` for arrow-key pickers. Without it you get a numbered prompt.

## Troubleshooting

- **"Forbidden" on first login**: clear the `vscode-tkn` cookie for `localhost`
  and refresh.
- **One stack at a time** (`container_name: pwb`). To compare two Workbench
  versions, `down` one and bring up the other.
- **Apple Silicon**: the Connect service runs emulated (amd64) and is slow to
  start.
