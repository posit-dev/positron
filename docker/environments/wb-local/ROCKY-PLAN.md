# Workbench e2e on Rocky Linux -- implementation plan

Goal: tag a PR with `@:workbench` and `@:workbench-rocky` and get the
`@:workbench` test suite running in parallel on Ubuntu 24 and Rocky Linux.

Status: planning. Nothing implemented yet.

## Target: Rocky 9, not Rocky 8

We already have `docker/images/rocky_8/` (published as
`ghcr.io/posit-dev/positron-rocky8:24.15.0`, used by `test-e2e-rhel.yml`), so
Rocky 8 looks like the path of least resistance. It isn't, for one reason:

**Posit publishes no arm64 Workbench package for RHEL 8.** The dailies feed has
`rhel8-x86_64` but no `rhel8-arm64`. RHEL 9 has both, on both channels:

| Channel | x86_64 | arm64 |
| --- | --- | --- |
| daily | `platforms["rhel9-x86_64"].link` | `platforms["rhel9-arm64"].link` |
| stable | `.rstudio.pro.stable.server.installer.rhel9.url` | same URL with `/x86_64/` -> `/arm64/` and `-x86_64.rpm` -> `-aarch64.rpm` (verified reachable) |

On Rocky 8 the local loop on Apple Silicon would be emulated amd64 and painfully
slow; on Rocky 9 it runs native. That difference is worth building a new image
for, because Step 4 (triaging the real suite) is where the calendar time goes and
it is the step that needs a fast loop.

So the project starts with a new `docker/images/rocky_9/` image, ported from
`rocky_8/`. `positron-rocky8` and `test-e2e-rhel.yml` are left untouched.

## What already exists (and what that buys us)

| Piece | State | Consequence |
| --- | --- | --- |
| `docker/images/rocky_8/` | Built, multi-arch (`docker-compose.{amd64,arm64}.yml`), published via `ci-images-build-os.yml` | The template for `rocky_9/`: R 4.5.2/4.4.2 via rig, pyenv 3.13, conda, hidden R 4.4.1 at `/root/scratch/R-4.4.1`, hidden conda Python at `/root/scratch/python-env`, `/root/.venv`, Quarto, and the e2e R/Python test deps. The per-arch build args (`R_ARCH_SUFFIX`, `RIG_ARCH`, ...) are already factored out. |
| `build-workbench-linux.yml` builds in `ghcr.io/posit-dev/positron-builds-rocky8:2` | Already Rocky-based | The `vscode-reh-web-pwb-linux-x64` tarball is compiled against glibc 2.28, which runs fine on Rocky 9's glibc 2.34 (forward compatible). **No glibc risk and no second build lane** -- both OS lanes consume the same artifact. This was the largest feasibility risk and it is already retired. |
| `rockylinux:9` base image | Multi-arch (amd64, arm64) on Docker Hub | Straight swap for `rockylinux:8`. |
| Tag boundary regex in `pr-tags-parse.sh` | Already correct | The bare-`@:workbench` matcher is `@:workbench([^a-zA-Z0-9_-]|$)`, so `@:workbench-rocky` will **not** spuriously trigger the Ubuntu lane. The two tags stay independent, exactly as `@:workbench-stable` does today. |
| `e2e-workbench` Playwright project | `grep: /@:workbench/`, `externalServerUrl: http://localhost:8787` | The Rocky lane runs the *same* test set through the *same* project. `@:workbench-rocky` is a **lane trigger only** -- never applied to individual tests. |

## What these tests are actually for (read this first)

Workbench ships with an **embedded Positron build**. The entire point of the
`@:workbench` lane is to **replace that embedded build with the PR's newer
Positron** and confirm Workbench still works with it. That is why the flow is
stop Workbench -> replace Positron on disk -> restart:

- `install-workbench.sh` extracts the downloaded Positron into
  `/usr/lib/rstudio-server/bin/positron-server/new` (preferred over the rpm's
  `bundled/`).
- `setup-workbench-docker/action.yml` then overwrites that `new/` directory with
  the branch build (`vscode-reh-web-pwb-linux-x64`) and runs
  `sudo rstudio-server restart` so rserver re-scans and picks it up.

A green lane still running the *bundled* Positron would be a false pass -- the
worst failure mode this project can have. So any change to the stop/restart path
must be judged against "did the swapped build actually get served", not merely
"is Workbench up".

**Good news, measured rather than assumed: Positron is resolved at SESSION LAUNCH
from whatever is on disk.** rserver does *not* cache the install list at startup,
despite the CI action's comment ("Restart so rserver re-scans installs"). Proven
on Rocky: with an rserver left running from when `new/` held build 331, swapping
`new/` to build 184 *without any restart* made the next new session report
**184**. Precedence is also confirmed: `new/` wins over `bundled/`.

This is what keeps the restart bug below from being a correctness problem.

### REAL BUG, NOT A CORRECTNESS BLOCKER: `rstudio-server restart` on Rocky

Verified empirically on the spike container by running exactly what the CI action
runs. `sudo rstudio-server restart` printed:

```
Stopping rstudio-server: [FAILED]
Starting rstudio-server: [  OK  ]
```

and left **two** rservers. The original kept `:8787`; the new one could not bind
and span in a retry loop:

```
rserver-http: nginx: [emerg] bind() to 0.0.0.0:8787 failed (98: Address already in use)
```

The service still answered `HTTP 302` -- from the original process. Exit status
is 0, so nothing fails the step. (The `[FAILED]` line and the nginx errors do
appear in the logs, so it is not completely invisible.)

**Impact, corrected.** An earlier revision of this document called this a
confirmed false pass. That was wrong: it assumed rserver caches the Positron
install at startup, which the session-launch test above disproves. Because new
sessions resolve Positron from disk at launch, the surviving pre-swap rserver
still serves the *new* build. What the bug actually costs:

- a duplicate rserver wedged in an nginx bind-failure retry loop (~2/second),
  spamming `rserver.log` for the life of the job and burning CPU;
- confusing process state that makes any later diagnosis harder;
- a `restart` whose exit code means nothing.

So: worth fixing, and it will bite eventually -- but it does **not** make the
lane test the wrong build.

Mechanism, from the separately verified facts:

- The init script's `restart)` case is **unguarded** -- it calls `restart()` ->
  `stop()` -> `killproc rserver` directly (unlike `stop)`, which the status guard
  short-circuits).
- `killproc rserver` was tested on Rocky and **fails**: prints `[FAILED]`,
  returns 0, and leaves rserver running (same `pidof -c` blindness as `status`).
- `start()` then runs `daemon $rserver` and, because status always reports
  stopped, adds a **second** rserver (duplicate rservers were observed directly).

This makes the swap+restart path a **Step 7 correctness blocker**, not the Step 4
harness annoyance it was previously recorded as.

Demonstrated end to end with a real build swap (bundled build 184 -> downloaded
build 331, `positron-workbench-linux-arm64-2026.08.0-331.tar.gz`, which also
confirms `positronDownload.sh` works on Rocky/arm64):

- **CI sequence (`rstudio-server restart`)**: swap at 22:43:20; the rserver still
  holding `:8787` afterwards had started at **22:34:26**, nine minutes before the
  new build existed. Two rservers, exit 0, `HTTP 302` served by the stale one.
  This is the false pass, reproduced.
- **Corrected sequence (signal-stop -> wait -> start)**: exactly one rserver,
  started after the swap, `HTTP 302`. Passes.

Mitigation to implement in Step 3/7:

1. Stop rserver by **direct signal, and escalate**. TERM is not reliable on its
   own: a settled rserver exits on TERM in ~1s, but in the duplicated/failing
   state produced by a bad restart it survived 30s of TERM and needed SIGKILL.
   So: TERM -> poll for exit -> SIGKILL after a timeout. (An earlier note here
   claimed rserver never blocks TERM; that was too strong.)
2. Start it again, and confirm exactly **one** rserver is running.
3. **Assert the served build.** Compare `positronVersion` /
   `positronBuildNumber` in the swapped `positron-server/new/product.json`
   against what the running server actually reports, and fail the job on a
   mismatch. This is the check that makes a false pass impossible, and it is
   worth adding to the **Ubuntu** lane too -- nothing there proves the swap took
   effect either; it just happens to work.

Note also that `install-workbench.sh` extracts Positron into
`positron-server/new` while the rpm's build sits in `positron-server/bundled`, so
Step 3 must confirm Workbench actually prefers `new/` on Rocky. If it silently
fell back to `bundled/`, that is the same false pass by a different route.

### Which files actually need changing (and which do not)

| File | Verdict |
| --- | --- |
| `setup-workbench-docker/action.yml` | **Should change (robustness, not correctness).** Its final `sudo rstudio-server restart` leaves a wedged duplicate rserver. Sessions still get the swapped build, so it is not a false pass. Replace with signal-stop -> wait -> start. |
| `workbench-local.sh` (`wb_ensure_workbench`) | **Should change.** Same duplicate-rserver problem on the `npm run pwb` resume path. Observed directly. |
| `install-workbench.sh` | **Should change, but is not broken.** Its pre-swap stop already has a `pkill -x rserver` safety net that fires after the (useless) 15s wait, so the swap is not racing in practice. Worth fixing anyway: `rstudio-server stop`'s exit status is meaningless on Rocky so the `log_error` branch is dead, the 15s wait is always burned, and there is **no wait after the pkill** before the install dir is mutated. Its trailing `rstudio-server start` is fine -- nothing is running by then. |

An "assert the served build" check is still worth adding (cheap insurance against
a genuinely broken swap, e.g. a failed download or a wrong-arch tarball), but it
is no longer urgent: the session-launch behaviour means a stale rserver cannot by
itself serve the wrong Positron. The cheap form is to assert that exactly one
rserver is running and that `new/product.json` holds the expected
version/build after the swap.

## Constraints and decisions

### The container has no systemd

Verified by listing the payload of the actual rhel9 arm64 daily rpm: it ships
SysV init scripts at
`/usr/lib/rstudio-server/extras/init.d/redhat/{rstudio-server,rstudio-launcher}`
and the binaries at `/usr/lib/rstudio-server/bin/{rserver,rstudio-launcher,rstudio-server}`,
but the RHEL postinst installs the **systemd units**
(`extras/systemd/*.redhat.service`) instead, so `/etc/init.d` stays empty. The
Ubuntu `.deb` installs its init scripts, which is why
`install-workbench.sh`'s `sudo rstudio-server start` and `workbench-local.sh`'s
`sudo /etc/init.d/rstudio-launcher start` work today.

Fix: on Rocky, copy `extras/init.d/redhat/*` into `/etc/init.d/` and `chmod +x`
during install. Then the existing start/stop/restart code paths work unchanged.
This is the most likely thing to need iteration, so it is the whole of Step 1.

Those scripts source `/etc/rc.d/init.d/functions`, so the Rocky branch of
`install-workbench.sh` also needs `dnf install -y initscripts` (verified
available on EL9 at 10.11.8). It goes in the installer rather than the image
because it is a Workbench-flow accommodation, not a general e2e dependency --
same reason the installer already installs `acl` and `environment-modules`.

### Decision: the container does NOT get systemd (revisitable)

Real RHEL 9 deployments run Workbench under systemd, so running it here is
tempting for fidelity. We are not doing it, for now:

- **Parity beats fidelity for this lane.** The Ubuntu `test` container has no
  systemd either (`init: true` plus a sleep loop; `rstudio-server start` falls
  back to the `.deb`'s SysV scripts). If Rocky ran under systemd and Ubuntu did
  not, a Rocky-only test failure would be ambiguous between a real OS difference
  and an init-system artifact -- which defeats the point of the lane.
- **EL9 still supports the SysV path**, so this is not a hack fighting the
  distro: `initscripts` is still packaged and still provides the `functions` file
  the scripts source.
- **Cost now is high**: systemd as PID 1 needs privileged mode or hand-mounted
  cgroups, displaces the sleep-loop PID 1 (breaking the TTL and `docker exec`
  patterns), and for parity would want to apply to both lanes -- a large change
  to shared, currently-working infrastructure.

This is deferrable rather than a one-way door because the init mechanism is
confined to three places: `install-workbench.sh` (service start),
`wb_ensure_workbench` in `workbench-local.sh` (restart), and the compose service
definition (`command:`, `privileged:`, cgroup mounts). No test code touches it --
tests talk to `http://localhost:8787`.

**The trigger to revisit** is concrete and Step 1 tests it: if the Launcher or
PAM session setup turns out to need logind (`XDG_RUNTIME_DIR`, `pam_systemd`).
The Ubuntu container copes without it today, so the same accommodations are
expected to carry over -- but if they don't, we learn it in the spike, before any
of the harness work in Steps 2-4.

### Existing Ubuntu-specific bug to fix on the way through

`install-workbench.sh:262` does `sudo chown 999:999 /var/lib/rstudio-server/workbench.lic`.
`999:999` is the `rstudio-server` uid/gid *on Ubuntu*; the Rocky rpm will pick a
different one. Change to `chown rstudio-server:rstudio-server`, correct on both.

### Shards: default only

`test-e2e-workbench-ubuntu.yml` runs a 4-way matrix: `default` plus `snowflake` /
`databricks` / `azure` credential shards. The Rocky lane runs **`default` only**.
Managed-credential plumbing is OS-independent, so the other three would triple
live cloud-auth usage for no new signal. Add them later only if a Rocky-specific
credential bug appears.

### Trigger: PR tag only, for now

The lane runs only when a PR carries `@:workbench-rocky`. Promote it to the
nightly / full-suite run once it has proven reliable, as a follow-up.

## Steps

Steps 3 and 6 need no Docker at all. Steps 1, 2 and 4 are the ones with real
unknowns.

### Step 0 -- `docker/images/rocky_9/` (DONE)

Built and published: **`ghcr.io/posit-dev/positron-rocky9:24.18.0`**, a
multi-arch manifest list covering `linux/amd64` and `linux/arm64`
([run 31198129140](https://github.com/posit-dev/positron/actions/runs/31198129140),
all three jobs green on the first attempt). Tag follows the existing convention
that image tags track the Node version, which is 24.18.0 here.

Both arches verified from the published image, including the two places where
rocky_8's arch-specific branches were deleted: Quarto 1.10.18 is on PATH (the
RPM install fix) and TinyTeX's xelatex/tlmgr are present on amd64 (no system
TeX Live fallback needed). GEOS 3.13.1 / GDAL 3.10.3 with sf/terra/gert/arrow
loading on both.


Port `docker/images/rocky_8/` to Rocky 9, **dropping every EL8-only workaround
rather than carrying it forward**. The full delta table and the reasoning now
live in [docker/images/rocky_9/README.md](../../images/rocky_9/README.md); the
short version is that EL9 + EPEL9 ship newer GEOS/GDAL/PROJ/libgit2 than Rocky 8
compiles from source, and a GCC that does C++20, so the source builds,
`gcc-toolset-13`, the arm64 TinyTeX fallback, and the `sf`/bokeh pins are all
gone.

Two findings from doing it that are worth knowing:

- **`__linux__/rockylinux8` is not a real PPM channel.** It 404s. The Rocky 8
  image has been pointing R at a nonexistent binary channel, which is very
  likely why it needs so much built from source. The correct channel for Rocky
  Linux 9 is `__linux__/rhel9` (per `packagemanager.posit.co/__api__/status` ->
  `.distros[].binaryURL`), which serves binaries and supports dated snapshots.
  Worth filing separately against `rocky_8` -- not fixed here, since that's a
  live CI image and a behavior change to it belongs in its own PR.
- **The EL9 base ships `curl-minimal`/`libcurl-minimal`**, which conflict with
  full `curl` and with the `libcurl-devel` R's `curl` package needs. The `dnf
  install` therefore needs `--allowerasing` to swap minimal -> full.

Four EL8 -> EL9 breakages had to be fixed, each a thing EL8 supplied
transitively: ten package renames, `--allowerasing` (the EL9 base ships
`curl-minimal`, which conflicts with `libcurl-devel`), `perl` (tlmgr is a Perl
script), and `libxcrypt-compat` (uv's CPython links `libcrypt.so.1`). All are
documented with their failure signatures in the image README.

**Verified in the built arm64 image:** Rocky 9.8 / glibc 2.34, GCC 11, Node
24.18.0, Quarto 1.10.18 (renders `.qmd` -> html), R 4.5.2 + 4.4.2 via rig, hidden
R 4.4.1, Python 3.10.12 venv + pyenv 3.13.0 (all stdlib modules incl. `ctypes`) +
hidden conda 3.12.10, TinyTeX with xelatex/latexmk, `pdol`, and `setfacl` +
`environment-modules` for the installer. `sf` 1.1.1 / `terra` 1.9.34 / `gert`
2.3.1 / `arrow` 24.0.0 all load against the *system* GEOS 3.13.1 / GDAL 3.10.3 /
libgit2 1.7.2, and all 33 declared e2e R deps installed (220 packages in the site
library) -- which is what confirms both the dropped source builds and the PPM
channel fix.

Also done: `rocky_9` added to `ci-images-build-os.yml` (choice, validation,
`OS_TAG`, `SOURCE_IMAGE`, and the merge job's mapping), and to the
`update-ci-images` skill (6 -> 7 builds, PR checklist, and both
`bump-node-version.sh` / `bump-ppm-snapshot.sh` file lists).

Two latent `rocky_8` bugs surfaced along the way. Both are left alone on purpose
-- it is a live CI image -- but each is worth its own issue:

1. Its PPM channel (`__linux__/rockylinux8`) does not exist and 404s, so its R
   packages are very likely all building from source. This is plausibly the root
   cause of the source-built GEOS/GDAL/libgit2 and `gcc-toolset-13` it carries.
2. Its Quarto `ar x` unpack leaves the binary off PATH, exactly as it did here.

Original delta list, for reference:

| Rocky 8 | Rocky 9 |
| --- | --- |
| `FROM rockylinux:8` | `FROM rockylinux:9` |
| `dnf config-manager --set-enabled powertools` | `--set-enabled crb` (PowerTools was renamed CodeReady Builder) |
| `deps/rocky8_packages_{amd64,arm64}.txt` | `deps/rocky9_packages_{amd64,arm64}.txt`. **Add `acl` and `environment-modules`** -- both are missing from the Rocky 8 lists and both are needed by `install-workbench.sh`. Baking them in beats installing at runtime. |
| RSPM `__linux__/rockylinux8`, UA `(rockylinux-8)` | `__linux__/rockylinux9`, `(rockylinux-9)` |
| Hidden R from `centos-8/R-4.4.1-centos-8${R_ARCH_SUFFIX}.tar.gz` | `rhel-9/R-4.4.1-rhel-9${R_ARCH_SUFFIX}.tar.gz` -- verified present for both `""` and `-arm64` |
| TinyTeX skipped on arm64 (needs glibc 2.29, Rocky 8 has 2.28), system TeX Live used instead | Rocky 9 has glibc 2.34, so **drop the arm64 special case** and use TinyTeX on both arches |
| `docker-compose.{amd64,arm64}.yml` building `positron-rocky8-${ARCH}:latest` | same, `positron-rocky9-${ARCH}:latest` |

Two simplifications worth attempting, each with a clean fallback of "leave it as
Rocky 8 had it":

- **Drop the from-source GEOS 3.12 / GDAL 3.9 / libgit2 1.8 builds.** They exist
  because Rocky 8's GDAL 3.0.4 predates `GDAL_DCAP_MULTIDIM_RASTER` (GDAL 3.1),
  which `terra` needs. Rocky 9 + EPEL 9 ship GDAL 3.4+, GEOS 3.10+ and a modern
  libgit2, which should clear every one of those bars. Removing them takes
  roughly 15-20 minutes off the image build and deletes the bulk of the
  Dockerfile's complexity (every subsequent `RUN` carries a long
  `PKG_CONFIG_PATH`/`LD_LIBRARY_PATH` prefix purely to find them).
- **Drop `gcc-toolset-13`.** It is pinned because Arrow needs C++20 and Rocky 8's
  system gcc 8 has none. Rocky 9's system gcc 11 supports `-std=gnu++20`, which
  should let the whole `Makeconf`-patching block go.

Do these *after* a straight port builds and passes Step 1, not as part of it --
they are cleanups, and bundling them in makes a build failure ambiguous.

Also add `rocky_9` to `ci-images-build-os.yml` (choice option, `OS_TAG=rocky9`,
`SOURCE_IMAGE=positron-rocky9-${ARCHITECTURE}:latest`) and publish
`ghcr.io/posit-dev/positron-rocky9`.

**Validate:** `docker compose -f docker/images/rocky_9/docker-compose.arm64.yml build`
locally, then in the container check `R --version`, `rig list`,
`python -c 'import polars'`, `quarto --version`, `Rscript -e 'library(sf); library(terra); library(gert)'`,
`setfacl --version`, `module --version`.

### Step 1 -- Manual spike: RESULT = GO (no systemd needed)

**Workbench installs and serves on Rocky 9 with no systemd.** Verified on the
built arm64 image with the rhel9 daily rpm (2026.08.0-daily+184.pro4): `GET /`
returns 302 to the sign-in page, and a real RSA-encrypted PAM sign-in as `user1`
returns 200 and lands on the authenticated `/s/<id>/workspaces/` homepage with a
`user-id` cookie. `verify-installation` also passes `positron-install-dir`.

So the "no systemd" decision above stands -- the revisit trigger did not fire.

What the spike found, all of which is input to Steps 2/3:

1. **`initscripts` is required.** The copied SysV scripts source
   `/etc/rc.d/init.d/functions` (line 8). Available on EL9 at 10.11.8.
2. **`rstudio-server`'s uid here is 995, not Ubuntu's 999** -- confirms the
   `chown 999:999` license bug is a genuine break, not a theoretical one.
3. **The shipped `extras/init.d/redhat/rstudio-launcher` script is broken three
   ways on EL9** and cannot be used as-is (all three verified by tracing):
   - Its install guard reads `[ -x "$rserver" ]`, but `$rserver` is never defined
     in *that* script (only in the rstudio-server one) -- a copy-paste bug that
     makes `start` `exit 0` and launch nothing, silently.
   - It calls `daemon --name=... --pidfiles=...` and `daemon ... --stop`. EL9's
     `initscripts` `daemon` supports none of those (only `+nicelevel`, `--check`,
     `--user`, `--pidfile`, `--force`), so it fails with a usage error. The
     working `rstudio-server` script uses plain `daemon $rserver` + `killproc`.
   - The launcher does **not** self-daemonize (rserver does), so even a corrected
     plain `daemon $launcher` blocks forever. It needs explicit backgrounding
     (`nohup setsid ... &`).
4. **`status` does not work on EL9 in a container, which silently breaks `stop`
   and `restart`.** EL9's `status` calls `pidof -c` (restrict to same root dir),
   which returns nothing for rserver even though plain `pidof rserver` finds it.
   Because the init script guards with `rh_status_q || exit 0`, **`rstudio-server
   stop` is a silent no-op** (exit 0, process still running). `killproc rserver`
   fails the same way ([FAILED], exit 0). Consequences, in order of severity:
   - **`wb_ensure_workbench` (workbench-local.sh) spawns duplicate rservers.**
     Its ordered restart is `rstudio-server stop` (no-op) -> launcher start ->
     `rstudio-server start`, and since status always reports stopped, the start
     adds a *second* rserver rather than replacing the first. Reproduced. This is
     the one genuine functional break; fix in Step 4.
   - **`install-workbench.sh`'s Positron swap is NOT broken.** Its existing
     safety net saves it: after the 15s wait times out, `pkill -x rserver`
     reliably stops rserver in ~1s (verified: `SigBlk` is 0 on a freshly started
     rserver from t=0 through t=8s, and TERM kills it immediately). The costs are
     a wasted 15s and a `stop` whose exit code means nothing -- not a race on the
     install dir. Still worth tidying: don't trust `rstudio-server stop`'s exit
     status on Rocky, and verify exit after signaling.

   NB an earlier reading of this suggested rserver blocks SIGTERM (`SigBlk
   0x14007`). That is **not** reproducible on a normally started rserver and was
   almost certainly a sample taken from one of the duplicate rservers above.
   Don't design around it.
5. **Order matters: wait for the launcher's *socket*, not its process.** rserver's
   `LauncherClient::initialize()` fails with ENOENT if
   `/var/run/rstudio-server/rserver-launcher.socket` is absent. Wait on
   `[ -S <socket> ]` (or `ss -xl`). Note a stale socket file survives a launcher
   crash, so socket-existence alone is necessary, not sufficient.
6. **`pgrep -x rstudio-launcher` can never match** -- Linux caps `comm` at 15
   chars and the name is 16, so it appears as `rstudio-launche`. The existing
   `wb_ensure_workbench` uses `pgrep -f <full path>`, which is correct; just
   don't "simplify" it to `-x`. (Also avoid `pkill -f rstudio-launcher` in a
   `docker exec` one-liner -- it matches the wrapper shell's own command line and
   kills the exec.)
7. **cgroups init fails but is non-fatal.** `enable-cgroups=1` in `launcher.conf`
   can't create `/sys/fs/cgroup/launcher` (read-only), and the launcher logs a
   WARNING and continues without per-session limits. Optionally set
   `enable-cgroups=0` to quiet it; not required.
8. **Create `/home/rstudio-server`.** Absent, the launcher warns that HOME is
   unset and plugins may inherit an incorrect one.

**Session launch: confirmed** by launching a Positron session from the browser
against this container (2026-08-06). Together with the 302 + PAM sign-in above,
that completes all three of the Step 1 exit criteria. Note it was verified
interactively rather than by script -- `verify-installation --verify-user` is
gated behind the broken stop/status described above, and the session-creation API
is scoped under `/s/<id>/` rather than the `/api/*` paths, so automated assertion
of session launch is left to the real e2e suite in Step 5.

**Reusable artifact:** the installed container was snapshotted as
`rocky9-wb-installed:latest`, which brings a working Workbench up in seconds
instead of repeating the ~40-minute install while iterating on Steps 2-4.
Services do not auto-start: start the launcher, wait for its socket, then rserver.

### Step 1 (original plan text, for reference)

Throwaway; nothing committed. By hand in a scratch container off the Step 0
image:

```bash
docker run -it --rm -p 8787:8787 positron-rocky9-arm64:latest bash
# then, inside:
#  curl -O <rhel9 daily arm64 rpm url>; dnf install -y ./rstudio-workbench-rhel-*.rpm
#  cp /usr/lib/rstudio-server/extras/init.d/redhat/* /etc/init.d/ && chmod +x /etc/init.d/rstudio-*
#  groupadd/useradd user1; chpasswd
#  install workbench.lic (chown rstudio-server:rstudio-server)
#  /etc/init.d/rstudio-launcher start; rstudio-server start
#  curl -sI localhost:8787
```

**Exit criteria:** `:8787` returns HTTP 200, a PAM login as `user1` succeeds in a
browser, and a Positron session launches. Keep a transcript of every command that
diverged from the Ubuntu path -- that transcript is the specification for Step 2.

Remaining unknowns this is meant to flush out, roughly by likelihood: the init.d
copy; PAM service naming (the rpm ships no `pam.d` file of its own, so rserver
falls back to the system `login` service); rpm dependency resolution against
EPEL/CRB; and the `rstudio-server` uid.

### Step 2 -- OS-parameterize the URL resolvers (pure bash, no Docker)

- `workbench-local-lib.sh`: give `wb_resolve_stable_url` / `wb_resolve_daily_url`
  an OS parameter (`noble` | `rhel9`) so they read the right JSON key, and teach
  the stable resolver the rhel9 arm64 rewrite (`/x86_64/` -> `/arm64/`,
  `-x86_64.rpm` -> `-aarch64.rpm`) alongside the existing noble
  `amd64` -> `arm64` one. Make `wb_is_deb_url` / `wb_deb_arch` / `wb_deb_version`
  package-format-aware -- `.deb` vs `.rpm`, `amd64|arm64` vs `x86_64|aarch64`,
  and the `rstudio-workbench-rhel-` filename stem rather than
  `rstudio-workbench-`. Probably rename them `wb_is_pkg_url` / `wb_pkg_arch` /
  `wb_pkg_version`.
- `get-latest-wb-noble-url.sh`: generalize to take an OS argument. It is copied
  into the container **by name** in three places (`workbench-local.sh`'s
  `WB_SCRIPTS`, `setup-workbench-docker/action.yml`, and `install-workbench.sh`'s
  `CI_STABLE_MODE` branch), so either update all three call sites or keep the old
  filename as a shim.
- Add `scripts/test/workbench-local-lib-test.sh`, modelled on
  `scripts/test/pr-tags-lib-test.sh`, stubbing the `_wb_fetch_*` seams with
  fixtures. The lib's header comment already promises those seams exist for
  testing but no test file was ever written; this step pays that off.

**Validate:** `bash scripts/test/workbench-local-lib-test.sh`. Seconds, offline.

### Step 3 -- Package-manager abstraction in `install-workbench.sh`

Introduce a `WB_OS` (`ubuntu24` | `rocky9`) switch and branch the apt-specific
parts: the `apt-get update` / `add-apt-repository universe` /
`apt-get install acl jq curl` preamble; the download filename and
`apt install ./workbench.deb`; `fetch_latest_wb_url`'s platform key; the
`environment-modules` install; the init.d copy from Step 1; and the
`chown 999:999` fix.

Keep the module-file setup identical across both OSes -- the Rocky image has the
same `/root/scratch/python-env` and `/root/scratch/R-4.4.1` layout, so
`POSITRON_HIDDEN_PY: "3.12.10 Module"` and `POSITRON_HIDDEN_R: 4.4.1` carry over
and the `@:environment-modules` tests keep working.

**Validate:** first re-run the *Ubuntu* stack (`npm run pwb -- --reinstall
--workbench=daily --positron=daily`) to prove no regression, then move on.

### Step 4 -- `--os` flag in the local harness

- `docker-compose.workbench.yml`: `image: ${WB_TEST_IMAGE:-ghcr.io/posit-dev/positron-ubuntu24:24.15.0}`.
- `workbench-local.sh`: accept `--os=ubuntu24|rocky9` (and `WB_OS` in `.env`),
  set `WB_TEST_IMAGE`, thread the OS into `wb_pick_workbench` and into the
  `docker exec` env for the installer. The image change makes Compose recreate
  the `test` container, which wipes the install -- so `--os` implies a reinstall;
  make that explicit rather than surprising.
- `wb_ensure_workbench`'s `/etc/init.d/rstudio-launcher` path now works on both,
  courtesy of Step 3.
- The compose file pins `container_name: test` and fixed host ports, so only one
  stack runs at a time locally. That is already documented; keep it, and require
  a `down` before switching OS if the recreate path proves fragile.

**Validate:** `npm run pwb -- --os=rocky9 --workbench=daily --positron=daily
--reinstall`, then `npm run pwb -- status` and a manual browser login. First
end-to-end proof.

### Step 5 -- Run the real suite locally against Rocky

`npx playwright test --project e2e-workbench` against the Rocky stack. Triage
every failure into one of three buckets:

1. harness gap (missing dep, wrong path) -> fix in Step 3/4;
2. genuine Rocky Positron bug -> file it (this is the point of the project);
3. legitimately not applicable on Rocky -> needs a skip mechanism.

Bucket 3 is the one design question this step may open. Prefer a
`process.env`-driven skip inside the affected test over a new tag, so the tag
namespace stays "which lane runs" rather than "which test runs where".

**Validate:** a green (or knowingly-triaged) local run. Expect this step to be
the bulk of the calendar time.

### Step 6 -- The `@:workbench-rocky` tag (pure bash, no Docker)

- `test/e2e/infra/test-runner/test-tags.ts`: add
  `WORKBENCH_ROCKY = '@:workbench-rocky'` to **`PlatformTags`** (not
  `FeatureTags`) so it can never be auto-derived from a test-file change. This
  also makes it pass `pr-tags-parse.sh`'s enum validation -- without it the tag
  is silently dropped as a typo and the lane never runs.
- `pr-tags-parse.sh`: add a `workbench_rocky_tag_found=true` block alongside the
  existing `workbench_stable` one.
- `scripts/test/pr-tags-lib-test.sh`: add `@:workbench-rocky` to the
  platform-tags-are-not-feature-tags list at line 416.

Keeping the tag OS-generic (`-rocky`, not `-rocky9`) means a future Rocky version
bump doesn't churn everyone's PR templates; the OS version is an implementation
detail of the lane.

**Validate:** `bash scripts/test/pr-tags-lib-test.sh`, plus a dry run of
`pr-tags-parse.sh` against a fake PR body asserting `@:workbench-rocky` alone
sets `workbench_rocky_tag_found` and **not** `workbench_tag_found`.

### Step 7 -- CI wiring

- Rename `test-e2e-workbench-ubuntu.yml` -> `test-e2e-workbench-linux.yml` and
  add an `os` input (default `ubuntu24`). Thread it to the `test` image, the
  installer, the shard matrix (Rocky: `default` only), the report identifier and
  the log-artifact names. Parameterizing beats copying: the workflow is ~260
  lines of secret loading, Tailscale, AWS/S3 and 1Password wiring we do not want
  in two places.
- `setup-workbench-docker/action.yml`: add an `os` input, pass `WB_OS` into the
  installer `docker exec`.
- `test-pull-request.yml`: surface `workbench_rocky_tag_found` in the `pr-tags`
  job outputs; add `|| ... workbench_rocky_tag_found == 'true'` to the
  `build-workbench` gate (otherwise a Rocky-only tag produces no artifact to
  test); add an `e2e-workbench-rocky` job with `os: rocky9` and
  `display_name: "workbench-rocky"`. Separate GitHub jobs means the two lanes run
  in parallel for free.
- `docker compose -p ${{ github.run_id }}` is identical in both lanes but they
  run on different runners, so there is no project-name collision.

**Validate:** a throwaway PR tagged `@:workbench @:workbench-rocky`; confirm two
lanes start, run the same test set, and report separately.

## Follow-ups (explicitly out of scope for now)

- Promote the Rocky lane into the nightly / full-suite run.
- The Rocky 9 Dockerfile simplifications (drop the source GEOS/GDAL/libgit2
  builds and `gcc-toolset-13`).
- Add the credential shards to the Rocky lane.
- Consider migrating `test-e2e-rhel.yml` from `positron-rocky8` to
  `positron-rocky9` so we maintain one Rocky image, not two.
