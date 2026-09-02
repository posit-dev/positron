# Local Positron & Workbench environment (`npm run pwb`)

Run Positron and Posit Workbench together on your machine, against versions you
pick, in one command.

## Prerequisites

- Docker Desktop with 8+ CPUs and 16 GB RAM.
- `workbench.lic` and `connect.lic` in `docker/environments/wb-local/`.
- `.env` is created from `.env.example` on first run; you are prompted for
  `WB_PASSWORD` if it is unset.
- Optional: `fzf` for arrow-key pickers (without it you get a numbered prompt).
  Install with `brew install fzf` (macOS), `sudo apt install fzf` (Debian/Ubuntu),
  `winget install junegunn.fzf` (Windows), or `conda install -c conda-forge fzf`.
- Windows: one extra setup step, see [Windows](#windows).

## Quick start

1. Login once, when prompted for a password, enter your **GitHub Personal Access Token**, not your GitHub password. The token needs `read:packages` scope.

   ```bash
   docker login ghcr.io -u <your_github_username>
   ```

2. Drop `workbench.lic` and `connect.lic` into `docker/environments/wb-local/`.
3. Create `.env` from `.env.example`. Secrets are in 1Password.
4. `npm run pwb`.

First run asks which Positron and Workbench you want, installs them, and brings
the stack up. Open http://localhost:8787 and log in as `user1` and password as set in `WB_PASSWORD`.

## Windows

Works on Windows x64 (the same amd64 packages CI installs). Run the commands from
PowerShell or Windows Terminal like anywhere else; the script itself executes
under Git Bash, and you never need a Git Bash window.

That last part is the one setup step. npm has to be pointed at Git Bash:

```bash
npm config set script-shell "C:\Program Files\Git\bin\bash.exe"
```

Without it npm runs scripts through `cmd.exe`, where bare `bash` resolves to
`C:\Windows\System32\bash.exe` -- the WSL launcher -- so the script would run
inside a Linux distro that typically has no reachable Docker daemon and no `gh`.
It detects that case and tells you rather than failing obscurely.

Two things behave differently than on macOS or Linux:

- Prefer PowerShell or Windows Terminal over a mintty (Git Bash) window.
  `npm run pwb -- shell` runs `docker exec -it`, and the `fzf` pickers both want
  a real Windows console; mintty is not one.
- The license files must be LF, not CRLF. Connect refuses to parse a CRLF
  license and just answers 402 forever, and rstudio-server rejects one outright.
  Both are staged through a CR strip now, so a license saved on Windows is
  handled, but see [Troubleshooting](#troubleshooting) if you hit it another way.

## Commands

| Command | What it does |
| --- | --- |
| `npm run pwb` | Bring the stack up. First run: pick versions and install. Already installed: (re)start and show status. Safe to re-run anytime. |
| `npm run pwb -- --reinstall` | Re-run the pickers and reinstall, to switch Positron/Workbench versions. |
| `npm run pwb -- --credentials=<type>` | Install with a managed data-source connection: `databricks`, `snowflake`, or `azure`. See [Managed credentials](#managed-credentials). |
| `npm run pwb -- --workbench=<release\|daily\|URL> --positron=<release\|daily\|TAG>` | Skip the version pickers. Required when there is no TTY (agents, CI, piped runs). See [Non-interactive runs](#non-interactive-runs). |
| `npm run pwb -- --ttl N` | Set the auto-stop to N minutes; `--no-ttl` disables it. |
| `npm run pwb -- status` | Containers, installed versions, and URLs. |
| `npm run pwb -- logs [svc]` | Tail logs: `rserver` (default), `connect`, or a container name. |
| `npm run pwb -- shell [svc]` | Open a shell in a container: `test` (default), `postgres`, or `connect`. |
| `npm run pwb -- --os=<os>` | Host OS for the test container: `ubuntu24` (default), `rocky9` or `opensuse15`. |
| `npm run pwb -- stop` | Pause the stack (containers stopped, volumes kept). |
| `npm run pwb -- down` | Tear the stack down (removes containers and volumes). |

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
  the workbench-nightly CI), or a custom package URL to pin a specific build.
  The URL is checked for format, arch, and reachability before install -- including
  that the package format matches the OS, so a `.deb` pinned against a `rocky9`
  stack is rejected up front rather than at install time.

## Non-interactive runs

The pickers read from `/dev/tty`, so they can't be answered by an agent, a cron
job, or a piped run. Name the builds up front instead and both pickers are
skipped:

```bash
npm run pwb -- --workbench=daily --positron=release
npm run pwb -- --reinstall --workbench=daily --positron=daily
# pin exact builds
npm run pwb -- --workbench=https://dl.dailies.rstudio.com/.../rstudio-workbench-...deb --positron=2026.08.0-304
```

`release` or `daily` resolves that channel's current build; anything else is used
verbatim (a package URL for `--workbench`, a build tag for `--positron`).
`WB_WORKBENCH` / `WB_POSITRON` in `.env` do the same. Without a TTY and without
these flags the run now stops and tells you what to pass, rather than silently
installing whichever build happened to be listed first.

Note that the e2e suites which exercise newer Positron features (for example
Data Connections) need `--positron=daily`; a release build can be too old and the
test fails on a missing UI element rather than anything real.

## Choosing the OS

The stack runs on Ubuntu 24 by default. Pass `--os=` (or set `WB_OS` in `.env`)
to run the same Workbench + Positron install on one of the other OSes the e2e
lanes cover:

| `--os=` | OS | e2e lane |
| --- | --- | --- |
| `ubuntu24` | Ubuntu 24.04 | `workbench` (default), `workbench-stable` |
| `rocky9` | Rocky Linux 9 | `workbench-rocky` |
| `opensuse15` | openSUSE Leap 15.6 | `workbench-suse` |

```bash
npm run pwb -- --os=rocky9     --workbench=daily --positron=daily
npm run pwb -- --os=opensuse15 --workbench=daily --positron=daily
```

The OSes differ in more than the base image, and all of it is handled for you.
Both rpm OSes install a `.rpm` instead of a `.deb` with `apt` -- Rocky from the
feed's `rhel9` entries with `dnf`, openSUSE from its `opensuse15` entries with
`zypper`. Each rpm's postinst installs systemd units, and these containers have
no systemd, so the installer copies the SysV init scripts the package ships (from
`extras/init.d/<family>/`) into `/etc/init.d/` and starts the session launcher
directly -- the launcher script Posit ships is unusable on EL9.

### openSUSE runs emulated on Apple Silicon

Posit publishes the openSUSE 15 Workbench package for **x86_64 only** (both the
daily and stable feeds), unlike `rhel9` and `noble`, which have arm64 builds. So
on an Apple Silicon Mac `--os=opensuse15` forces the `test` container to
`linux/amd64` and runs it under emulation. The run says so up front. It works,
and it is what CI runs natively, but expect the install and the tests to be
noticeably slower than the other two OSes. Asking for an arm64 openSUSE build
fails fast with an explicit message rather than silently downloading the x86 rpm.

### Switching OS reinstalls

`--os` changes the compose `image:`, which makes Compose recreate the `test`
container. That wipes the in-container install, so **switching OS always
reinstalls**; the run tells you when it is about to do that. Only one stack runs
at a time locally either way, because the compose file pins `container_name` and
fixed host ports.

Once a stack exists, a bare `npm run pwb` **stays on whatever OS it already is**,
so resuming a Rocky stack doesn't silently rebuild it as Ubuntu. Pass `--os`
(or set `WB_OS`) to move it deliberately.

## Managed credentials

To test Positron's managed data-source connections (the credentials Workbench
hands to a session), install with `--credentials=<type>`. One provider per
install; re-run with `--reinstall --credentials=<type>` to switch.

| Type | Configures | Reads from `.env` |
| --- | --- | --- |
| `databricks` | `/etc/rstudio/databricks.conf` + `databricks-enabled` | `DATABRICKS_URL_`, `DATABRICKS_CLIENT_ID_` |
| `snowflake` | `/etc/rstudio/snowflake.conf` + `allow-refresh-snowflake-roles` | `SNOWFLAKE_ACCOUNT_`, `SNOWFLAKE_CLIENT_ID_`, `SNOWFLAKE_CLIENT_SECRET_` |
| `azure` | OpenID auth in `rserver.conf` + `openid-client-secret` + JIT home dirs | `AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_` |

1. Put the values for your provider in `docker/environments/wb-local/.env` (templated in
   `.env.example`). They live in the team 1Password vault. Wrap each value in
   single quotes -- `.env` is sourced by the shell, so a secret containing a `$`,
   space, or `#` is mangled (or errors out) without them. The trailing underscore
   on the names above is optional locally; the bare names (`SNOWFLAKE_ACCOUNT`, as
   stored in 1Password / GitHub secrets) are accepted as aliases.
2. Install with the flag:
   ```bash
   npm run pwb -- --credentials=snowflake
   ```
   The install fails fast if the chosen provider's variables are unset.

## Access

| Service | URL | Login |
| --- | --- | --- |
| Workbench | http://localhost:8787 | `user1` / `WB_PASSWORD` (from `docker/environments/wb-local/.env`) |
| Connect | http://localhost:3939 | bootstrapped per run |

## Troubleshooting

- **"Forbidden" on first login**: clear the `vscode-tkn` cookie for `localhost`
  and refresh.
- **One stack at a time** (`container_name: test`). To compare two Workbench
  versions, `down` one and bring up the other.
- **Apple Silicon**: the Connect service runs emulated (amd64) and is slow to
  start.
- **`dependency failed to start: container connect is unhealthy`**: usually the
  Connect license. Connect starts either way, so check what it thinks it has:

  ```bash
  docker exec connect /opt/rstudio-connect/bin/license-manager status
  ```

  An empty "License file status" with `Has-Key: No` means the file was not parsed
  at all, and every request answers 402. A CRLF license does exactly this (see
  [Windows](#windows)); so does a missing or expired one.
