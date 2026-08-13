# Workbench e2e on Rocky Linux -- implementation plan

Goal: tag a PR with `@:workbench` and `@:workbench-rocky` and get the
`@:workbench` test suite running in parallel on Ubuntu 24 and Rocky Linux.

Status (2026-08-12): **Steps 0-7 are done, and the lane has had its first CI run.** Steps 0-1 merged as #15407, Steps 2-4
as #15429. Steps 5 (first real suite run on Rocky, triaged), 6 (the
`@:workbench-rocky` tag) and 7 (CI wiring) are on this branch, so a PR tagged
`@:workbench-rocky` now starts a real lane.

```bash
npm run pwb -- --os=rocky9  --workbench=daily --positron=daily
npm run pwb -- --os=ubuntu24 --workbench=daily --positron=daily   # the default
```

**One expected failure remains, and it is a product bug rather than lane work.**
Step 5 started from four Rocky failures; two were fixed here, one was a
misattribution, and one is filed:

| Failure | Outcome |
| --- | --- |
| `connect/publisher-quarto-r` | **Fixed**, CI-verified -- PAM sessions had no `/usr/local/bin` on PATH. |
| `console/files-pane-refresh` | **Fixed**, CI-verified -- Explorer list virtualization plus state left by an earlier test. |
| `connect/publisher-shiny` | **Not Rocky** -- passes on Rocky in CI; the local failure was arm64 or flake. |
| `environment-modules` (Python) | **Filed as [#15509](https://github.com/posit-dev/positron/issues/15509)** -- positron-python probes a module interpreter by bare name. Root cause understood; do not work around it in the lane. |

So a reviewer (or a future session) seeing a red `workbench-rocky (default)` should
expect exactly one test, #15509's. The lane is PR-tag-triggered, so it blocks
nobody meanwhile. Full evidence in
[Step 5's results](#step-5----run-the-real-suite-locally-against-rocky-done).

`test-e2e-rhel.yml` still pins `positron-rocky8:24.15.0`; repointing it is a
separate PR.

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

Demonstrated end to end with a real build swap (bundled build 184 -> downloaded
build 331, `positron-workbench-linux-arm64-2026.08.0-331.tar.gz`, which also
confirms `positronDownload.sh` works on Rocky/arm64):

- **CI sequence (`rstudio-server restart`)**: swap at 22:43:20; the rserver still
  holding `:8787` afterwards had started at **22:34:26**, nine minutes before the
  new build existed. Two rservers, exit 0, `HTTP 302` served by the stale one.
- **Corrected sequence (signal-stop -> wait -> start)**: exactly one rserver,
  started after the swap, `HTTP 302`. Passes.

Note the stale-rserver detail above is *not* by itself a wrong-build test run --
the session-launch behaviour documented earlier means that rserver still hands new
sessions whatever is on disk. Fix it for the duplicate-process mess, not because
the lane would test the wrong Positron.

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

`test-e2e-workbench-linux.yml` runs a 4-way matrix: `default` plus `snowflake` /
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

**Three** latent `rocky_8` bugs surfaced along the way, all now fixed and merged
in the same PR as this image (#15407):

1. Its PPM channel `__linux__/rockylinux8` does not exist and 404s -- R reported
   zero available packages and fell back to source builds. Corrected to
   `centos8`, which is what PPM's own API maps `rhel8` to. (Rocky **9** is
   `rhel9`; there is no `rockylinux*` channel at all.) After the fix PPM served
   **216 binary packages** on x86_64, and aarch64 binaries too -- which confirms
   this was forcing the source builds.
2. Its Quarto `ar x` unpack left the binary off PATH (confirmed against the
   published `positron-rocky8:24.18.0` image config -- `/opt/quarto/bin` is not
   in `PATH` and no symlink is created). Now installs the RPM, verified to work
   on EL8.
3. **`sf`, `terra` and `gert` could not load at all.** The final `ENV` block
   *assigned* `LD_LIBRARY_PATH` rather than prepending, discarding the
   `/opt/gdal`, `/opt/libgit2` and `/opt/geos` entries accumulated above -- so
   packages compiled against those libraries failed at runtime with
   `libgdal.so.35: cannot open shared object file` and `libgit2.so.1.8`. This was
   **pre-existing, not caused by fix 1**: verified by running the same check
   against the previously published image
   (`positron-rocky8-arm64@sha256:a52f0ea9`), which fails identically.

Fixing 1 also required `pkg.include_linkingto = TRUE` (added to both images):
once PPM serves binaries, pak omits `LinkingTo` dependencies from the plan, so
the packages that have *no* binary for an arch (`arrow` on aarch64) can no longer
be built from source. This is the remedy pak itself suggests.

**Open follow-up:** all three bugs trace back to `rocky_8`'s `/opt` source-build
machinery (GEOS/GDAL/libgit2 + `gcc-toolset-13`), which is plausibly unnecessary
now that its PPM channel works -- `rocky_9` needs none of it. Removing it changes
what the R packages link against, so it wants its own validation pass.

Original delta list, for reference:

| Rocky 8 | Rocky 9 |
| --- | --- |
| `FROM rockylinux:8` | `FROM rockylinux:9` |
| `dnf config-manager --set-enabled powertools` | `--set-enabled crb` (PowerTools was renamed CodeReady Builder) |
| `deps/rocky8_packages_{amd64,arm64}.txt` | `deps/rocky9_packages_{amd64,arm64}.txt`. **Add `acl` and `environment-modules`** -- both are missing from the Rocky 8 lists and both are needed by `install-workbench.sh`. Baking them in beats installing at runtime. |
| RSPM `__linux__/rockylinux8` (which does not exist -- since fixed to `centos8`) | `__linux__/rhel9`, UA `(rockylinux-9)` |
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

**Reusable artifact:** the installed container was snapshotted (locally, on the
machine where the spike ran) as `rocky9-wb-installed:latest`, which brings a
working Workbench up in seconds instead of repeating the ~40-minute install while
iterating on Steps 2-4. It is not published anywhere -- recreate it by following
this step if it is gone. Services do not auto-start: start the launcher, wait for
`/var/run/rstudio-server/rserver-launcher.socket`, then start rserver.

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

### Step 2 -- OS-parameterize the URL resolvers (DONE)

Done as specified, plus a rename and a CI hook. All four OS/arch combinations
resolve on both channels, and **all eight resolved URLs were verified HTTP 200
against the live feeds**.

What landed:

- `workbench-local-lib.sh` takes an OS parameter (`noble` | `rhel9`) on
  `wb_resolve_stable_url` / `wb_resolve_daily_url`. Everything that differs
  between the two OSes now funnels through four one-line helpers
  (`wb_os_valid`, `wb_os_pkg_ext`, `wb_os_pkg_stem`, `wb_os_key_arch`), so a
  third OS means editing those and nothing else.
- `wb_is_deb_url` / `wb_deb_arch` / `wb_deb_version` renamed to `wb_is_pkg_url` /
  `wb_pkg_arch` / `wb_pkg_version` and made format-aware. `wb_pkg_arch`
  *normalizes* to `amd64|arm64` so callers keep comparing against `WB_ARCH`.
- `wb_validate_wb_url` and `wb_url_reachable` moved from `workbench-local.sh`
  into the lib so they are testable, and validation now also rejects a package
  whose **format** doesn't match the OS (a `.deb` pinned against a rocky9 stack)
  -- the likeliest paste-o once two lanes exist.
- `get-latest-wb-noble-url.sh` -> **`get-latest-wb-url.sh`**, taking `<os>
  [arch]`, and reduced to a thin wrapper that *sources the lib* rather than
  carrying its own copy of the rewrite rules. All three call sites updated
  (`WB_SCRIPTS`, `setup-workbench-docker/action.yml`, `install-workbench.sh`).
  **Consequence: `workbench-local-lib.sh` is now copied into the container too**
  -- any new copy site must copy both files or the wrapper fails fast with an
  explicit "not found next to this script" error.
- `install-workbench.sh` got only a `WB_OS` default (`noble`) to feed that call.
  Its apt-specific install path is untouched -- that is Step 3.
- `scripts/test/workbench-local-lib-test.sh`: 73 offline checks, fixtures
  captured verbatim from the live feeds. Wired into CI as
  `.github/workflows/test-wb-local-scripts.yml` (path-scoped to
  `docker/environments/wb-local/**`, modelled on `test-cache-scripts.yml`), which
  also `bash -n`s every script in the directory -- a syntax error there otherwise
  surfaces partway through a 40-minute in-container install.

Three things worth knowing downstream:

1. **The rhel9 feed uses two different spellings of arm64.** The dailies
   *platform key* is `rhel9-arm64`, but the *filename* in that same entry is
   `-aarch64.rpm`. (amd64 is `x86_64` in both.) So the feed-key spelling
   (`wb_os_key_arch`) and the filename spelling (`wb_pkg_arch`, plus the rewrite
   in `wb_resolve_stable_url`) are deliberately handled in separate places.
   "Correcting" the key to say `aarch64` is the obvious-looking fix and it just
   404s; there is a test pinning it.
2. **The stable rhel9 arm64 URL is derived, not published.** downloads.json
   carries only x86 for every OS. `noble` needs one substitution
   (`amd64` -> `arm64`); `rhel9` needs two different ones (path `/x86_64/` ->
   `/arm64/`, filename `-x86_64.rpm` -> `-aarch64.rpm`). Both rewrites are
   guarded, so a feed that ever starts publishing arm64 directly passes through
   untouched instead of producing `...-aarch64.rpm-aarch64.rpm`.
   `get-latest-wb-url.sh` still HEAD-checks derived arm64 URLs before returning
   them.
3. **Don't substitute slashes inside `${var//.../...}`.** The first cut wrote the
   path rewrite that way; the escaping needed for the `/` delimiter is read
   differently by bash and zsh, and it silently produced a URL containing literal
   backslashes. It now splits on the last slash and rewrites the two halves
   separately -- verified byte-identical under both shells.

**Open decision for Step 4: which OS names the `--os` flag exposes.** The lib
deliberately speaks only the *feed's* vocabulary (`noble` | `rhel9`), because
those strings are literally the JSON keys. Step 4 as written proposes
`--os=ubuntu24|rocky9` (the *image* names). Either adopt `noble|rhel9` end to end
or map at the flag -- but don't let both vocabularies leak into the middle
layers. `wb_os_valid` currently rejects `ubuntu24`/`rocky9` outright, and there
is a test asserting exactly that, so the choice can't be made by accident.

**Validated:** `bash scripts/test/workbench-local-lib-test.sh` (73 PASS,
offline, ~1s); the suite re-run against three deliberate mutations of the lib
(dropped rhel9 filename rewrite, `key_arch` confusion, deb stem applied to rpms)
to confirm it fails when the code is wrong; all 8 live URLs HEAD-checked 200; and
`wb_pick_workbench` driven directly for both OSes, including the rejection paths
and the rendered menu labels.

### Step 3 -- Package-manager abstraction in `install-workbench.sh` (DONE)

`WB_OS` (`ubuntu24` | `rocky9`) now gates every OS-specific step, validated at
the top of the script so a bad value fails immediately:

- **Dependency preamble**: `dnf install acl jq curl initscripts` on Rocky vs the
  apt/`add-apt-repository universe` sequence. `initscripts` is genuinely absent
  from the image (verified: `package initscripts is not installed`) and is what
  provides `/etc/rc.d/init.d/functions`, which the shipped SysV scripts source.
- **Download + install**: `workbench.${WB_PKG_EXT}` and `dnf install` vs
  `apt install`. The download also gained `curl -fL`; without `-f` a 404 wrote an
  HTML error page into `workbench.deb` and the failure surfaced later, as a
  confusing package error.
- **init.d copy**: the rpm's postinst installs systemd units, so `/etc/init.d`
  really is empty on a fresh container (verified). The installer copies
  `extras/init.d/redhat/{rstudio-server,rstudio-launcher}` into `/etc/init.d/`
  and marks them executable, and hard-fails if that directory is missing.
- **`/home/rstudio-server`** created, so the launcher stops warning that HOME is
  unset.
- **License ownership**: `chown 999:999` -> `chown rstudio-server:rstudio-server`.
  Confirmed necessary rather than theoretical: the uid is **995** on Rocky.
- **`fetch_latest_wb_url` deleted** in favour of the lib's `wb_resolve_daily_url`,
  which the container already has. Its hardcoded 2025.11 jammy fallback URL went
  with it: silently installing a year-old build of the wrong OS is worse than
  failing, and it could never have been right for Rocky.
- **`environment-modules`** installed with the OS's package manager. The
  modulefile setup itself is unchanged and shared -- the Rocky image has the same
  `/root/scratch/{R-4.4.1,python-env}` layout, so `POSITRON_HIDDEN_PY` /
  `POSITRON_HIDDEN_R` and the `@:environment-modules` tests carry over untouched.

Two service-control helpers replaced inline code, because the EL9 init scripts
cannot be trusted (Step 1):

- `stop_rserver` signals and **verifies**, escalating TERM -> KILL, instead of
  believing `rstudio-server stop`'s exit status (a silent no-op on Rocky).
- `start_workbench` starts the launcher directly with `nohup setsid` on Rocky and
  waits for its **socket** (not its process) before starting rserver. The
  launcher init script the rpm ships is unusable on EL9 in three separate ways,
  all documented inline at the function.

### Step 4 -- `--os` flag in the local harness (DONE)

- `docker-compose.workbench.yml`: `image: ${WB_TEST_IMAGE:-...ubuntu24...}`. The
  default keeps a bare `docker compose up` and the CI action on Ubuntu.
- `workbench-local.sh`: `--os=ubuntu24|rocky9` (or `WB_OS` in `.env`), validated
  before any Docker work so a typo costs a second rather than several minutes.
  Precedence is `--os` > `.env` > `ubuntu24`, which required applying the flag
  *after* `wb_bootstrap_env` -- it sources `.env` under `set -a` and would
  otherwise clobber the flag.
- Switching OS changes the image, so Compose recreates `test` and the install is
  wiped. The run now says so explicitly ("Switching the test container to
  --os=..., this recreates the container") rather than letting the reinstall look
  spurious.
- `status` reports the OS of the **running container**, mapped back from its
  image, not `$WB_OS` -- `status` never parses `--os`, so the variable would
  always read `ubuntu24` and could contradict what is actually up.

**Sticky OS.** Once a stack exists, a bare `npm run pwb` stays on its OS instead
of falling back to the `ubuntu24` default -- otherwise resuming a Rocky stack
would recreate the container and silently discard a ~10-minute install. An
explicit `--os` or a `WB_OS` in `.env` still wins; the `.env` case is detected by
grepping the file, because the variable alone cannot distinguish "unset" from
"explicitly ubuntu24".

**Two real bugs found and fixed while wiring this up, both the same root cause.**
`wb_ensure_workbench` checked for the session launcher with
`docker exec test bash -c 'pgrep -f /usr/lib/rstudio-server/bin/rstudio-launcher'`.
That pattern matches the **wrapper shell's own command line**, so it returns a
pid unconditionally -- proven by running it against a launcher path that does not
exist and still getting a pid back. The launcher therefore always looked alive,
and the one case the function exists to repair (rserver up, launcher dead ->
"Unable to contact session launcher") would be skipped. Pre-existing on Ubuntu;
the fix is the `[/]usr/...` bracket form. Note `pgrep -x rstudio-launcher` is
*not* an alternative -- comm truncates to 15 chars, so it reads
`rstudio-launche`.

The **second** instance was newly written Rocky code, and the bracket form did
not save it: the `docker exec` string both grepped for the launcher *and*
contained the launcher's literal path in order to start it, so the pattern
matched that second, unbracketed copy in the very same command line and the guard
took its `exit 0` path. The launcher was never started and the wait then accepted
the **stale socket left over from before the stop** -- so a resumed Rocky stack
came back with rserver up, no launcher, and a dead socket, which fails only later
when a session is launched.

The lesson generalizes: bracketing hides the pattern's *own* text, not another
copy of the path sitting beside it. The fix is to not re-check in the same
command at all -- `wb_ensure_workbench` already computed the answer in a
dedicated `docker exec` whose command line contains only the bracketed pattern,
so the start block reuses that variable. Removing the socket before waiting is
what makes the wait mean anything.

**Validation (all run locally on arm64):**

| Flow | Result |
| --- | --- |
| `--os=ubuntu24 --reinstall` | Positron 2026.09.0-12 on Workbench 2026.08.0+187.pro5, 0 errors, HTTP 302, exactly one rserver |
| `--os=rocky9 --reinstall` | same builds from `...-aarch64.rpm`, 0 errors, HTTP 302, sign-in page renders, one rserver, one launcher |
| Rocky package/init specifics | `/etc/init.d/{rstudio-server,rstudio-launcher}` installed by the copy step; license `rstudio-server:rstudio-server (995:995) 600`; `positron-server/new` holds the swapped build alongside `bundled/` |
| bare `npm run pwb` on a Rocky stack | stays `rocky9`, no recreate, no reinstall |
| `stop` then resume on Rocky | launcher restarted, socket recreated (mtime advances), one rserver, HTTP 302 |
| invalid `--os=rocky` / `--os=rhel9` | rejected in under a second, before any Docker work |

### Step 5 -- Run the real suite locally against Rocky (DONE)

First full run of the default shard against Rocky 9 (arm64, Positron 2026.09.0-35
on Workbench 2026.08.0+187.pro5): **30 passed, 8 failed, 9 skipped** in 33.5m.

Green, and worth listing because these are the ones that exercise the image's
toolchain: both data-explorer suites, duckdb + sqlite data-connections, all three
plots, all three `quarto-r` renders (including pdf via typst),
bootstrap-extensions, layouts, and all three enforced-settings tests.

**Every failure was attributed by re-running the same tests on an Ubuntu stack on
the same machine** (same arm64, same Connect container, same Positron/Workbench
builds -- only the OS differs). That control run passed 5/5, which is what makes
the attribution below trustworthy rather than a guess.

| Failure | Verdict | State |
| --- | --- | --- |
| `posit-assistant-signin` x3 (anthropic-api, openai-api, posit-ai) | **Not Rocky.** Local env gap: `ANTHROPIC_KEY` / `OPENAI_KEY` / `POSIT_AUTH_HOST`+`POSIT_EMAIL`+`POSIT_PASSWORD` are absent from `.env.e2e-workbench`. posit-ai says so outright ("OAuth auth host not configured"). | Documented in `.env.e2e-workbench.example` |
| `environment-modules` (R) | **Rocky-only.** Two bugs, below. | **Fixed** |
| `environment-modules` (Python) | **Rocky-only.** Same two bugs, plus a third layer still open. | Partly fixed |
| `connect/publisher-quarto-r` | **Rocky-only.** Root cause proven, below. | Open |
| `connect/publisher-shiny` | **Not Rocky** -- see the CI results below. It passes on Rocky in CI; the local failure was arm64 or flake. | Closed |
| `console/files-pane-refresh` | **Test fragility Rocky exposed**, not a Rocky defect. Cascade of the publisher failure. | **Fixed** |

The 9 skips are all explained and none are Rocky: redshift x3 needs
`REDSHIFT_TEST_HOST`, postgres x3 + `connections-postgres` x2 are gated on
`process.platform === 'darwin'`, and the Assistant layout test skips on its own.
Note this means a local run **under-covers** exactly the suites that need private
infrastructure; CI's Rocky lane will actually run them.

#### Fixed here: the module environments were invisible to the session user

Two independent bugs, both of which made `module avail` list nothing in the
session while the install still reported success:

1. **A leaked umask.** `ensure-connect-token.sh` set `umask 077` and never
   restored it. That is the right umask for a token file, but the script is
   *sourced* by `install-workbench.sh` and its function is called unconditionally
   just before the modulefile setup -- so the modulefile tree was created
   `0700`/`0600` root-only, as was `~/.profile`. Now scoped to a subshell around
   the token write, and the modulefile modes are stated explicitly
   (`install -d -m 755` + `chmod 644`) instead of inherited.
2. **`~/.profile` is never read on EL9.** Bash reads it only when
   `~/.bash_profile` and `~/.bash_login` are both absent; EL9's `/etc/skel` ships
   a `~/.bash_profile` (which sources only `~/.bashrc`). So the installer's
   `module use` append was dead code on Rocky -- `MODULEPATH` never gained
   `/opt/modules/modulefiles`. Now written to `/etc/profile.d/positron-modules.sh`
   (read by login shells on both OSes) plus an idempotent `~/.bashrc` append.

With those two fixed the **R** test passes on Rocky. The **Python** one is a
product bug, now filed as
[#15509](https://github.com/posit-dev/positron/issues/15509) and **not** something
this lane should work around.

positron-python's `ModuleEnvironmentLocator` finds the interpreter at an absolute
path (`/root/scratch/python-env/bin/python3`) and the kernelSpec argv uses it, but
the ipykernel setup then probes the interpreter as the **bare name `python`** via
`/bin/sh`, applying neither that path nor the module startup command it logs a line
earlier. EL9 ships only `python3`, so the probe exits 127, `implementation` comes
back `undefined`, the bundled ipykernel is skipped
(`unsupported interpreter implementation: undefined`), and the install path's
sqlite3 guard -- probing the same bare name -- reports "The Python sqlite3
extension is required but not installed". That message is a red herring: sqlite3,
the interpreter and the libraries are all fine.

Ubuntu masks it because `/usr/bin/python` exists, so the probe succeeds against a
*different interpreter than the module's* -- meaning the bundle's arch/`cpXY`
selection is currently made from the wrong Python there too. Getting this required
copying the `Python Language Pack.log` out of the container mid-run, since the
fixture destroys the session's log directory on teardown.

#### Open, root cause proven: publisher can't resolve quarto on Rocky

`publisher-quarto-r` fails with a Connect-side render error that looks like a
Connect or R problem and is neither:

```
[connect-quarto] Running 'quarto render'
ERROR: Error executing 'Rscript': Failed to spawn 'Rscript': entity not found
Unable to locate an installed version of R.
```

The chain: the bundle manifest Connect receives says
`"quarto": {"version": "1.7.34", "engines": []}`. Connect keys R provisioning off
those engines, so an empty list means it never puts `/opt/R/4.6.1/bin` on the
render's PATH (R *is* in the Connect container and Connect detects it at startup).
`1.7.34` is not a real quarto anywhere in the stack -- it is a hardcoded fallback
in the publisher extension (`fZ="1.7.34"` in `posit.publisher-2.8.0`), which means
publisher never successfully inspected the document.

Established by swapping one variable at a time on an otherwise-passing Ubuntu
stack:

| Stack | quarto on PATH | publisher recorded | Result |
| --- | --- | --- | --- |
| Rocky 9 | 1.10.18 (present) | `1.7.34`, `engines = []` | fail |
| Ubuntu 24 | 1.9.38 | `1.9.38`, engines populated | pass |
| Ubuntu 24 | swapped to 1.10.18 | `1.10.18`, engines populated | pass |
| Ubuntu 24 | **removed** | `1.7.34`, `engines = []` | **fail, identically** |

So the cause is that publisher cannot find `quarto` when it inspects, and **not**
a Quarto version incompatibility -- an earlier revision of this document blamed
Quarto 1.10 (the images ship different versions because both fetch
`download/latest`); row 3 disproves that, and pinning Quarto would have fixed
nothing.

Two things make this hard to see, worth knowing before picking it up:

- **The status bar reads "Quarto: 1.9.38" even when it is broken.** Positron's
  Quarto extension resolves Workbench's bundled quarto by a different mechanism
  than publisher uses, so the UI looks healthy.
- On Rocky, `user1`'s *login* PATH does contain a working
  `/usr/local/bin/quarto` (1.10.18). So the gap is in the **extension host's**
  environment, not the login shell -- the same class of problem as the
  `.bash_profile` bug above. The next diagnostic is to print the extension
  host's `process.env.PATH` in a Rocky session.

#### Confirmed in CI, with one retraction

First real lane run ([run 31526068531](https://github.com/posit-dev/positron/actions/runs/31526068531?pr=15472)),
which added the two things the local run could not: **amd64** and the real
credentials.

- **The regression check passed.** `workbench (default)`: 46 passed, 1 skipped, 0
  failed -- including both `@:environment-modules` tests, which is the specific
  thing the umask and profile.d changes had to not break. All three credential
  shards passed.
- **Rocky lane**: 42 passed, 3 failed, 1 flaky, 1 skipped. The `shards` job
  emitted exactly one shard, the rpm resolved and installed, and the lane reported
  separately -- so the wiring works.
- **`environment-modules` (R) passes on Rocky in CI**, confirming the umask +
  profile.d fixes work on the real lane and not just locally.
- **Retraction: `publisher-shiny` is not Rocky-specific.** It passes on Rocky in
  CI. It was called Rocky-only because the local Ubuntu control passed it while
  Rocky failed -- on amd64 with real credentials it is fine, so the local failure
  was arm64 or flake. `publisher-quarto-r` does reproduce, so the
  quarto-resolution root cause stands; it accounts for one publisher test, not two.
- **The assistant tests are not a Rocky problem.** All three sign-ins pass on
  Rocky (`openai-api` failed once and passed on retry). The same test is the only
  `workbench-stable (default)` failure, and `workbench-stable (azure)` is
  `posit-assistant-foundry` failing with `OTP authentication failed after 3
  attempts` -- pre-existing credential flake in a lane whose behaviour this work
  does not change.

#### Fixed: `files-pane-refresh` was a cascade, not a Rocky defect

`verifyExplorerFilesExist` asserted a row was visible inside the Explorer's
**virtualized** list. A row outside the rendered window is absent from the DOM
rather than scrolled out of sight, which is why it failed with `element(s) not
found` and could not recover. Whether a row is inside that window depends on how
many folders are expanded, and the `app` fixture is `{ scope: 'worker' }` -- so
expansion state accumulates across every earlier test in the session.

Order in the Rocky lane: `publisher-quarto-r` (#3, failed) ... `files-pane-refresh`
(#8, failed). The publisher tests leave `.posit/publish/deployments/...` expanded,
pushing the root-level `file.txt` below the rendered window. Fixed by collapsing
the tree first, which makes the assertion depend only on the file existing. All
ten callers assert root-level files, so collapsing is safe for them; verified
locally against `files-pane-refresh` and the `plots` suite (five calls).

The general lesson for this lane: **a worker-scoped session means a failing test
can fail a later, unrelated one.** Expect some Rocky failures to be cascades, and
check test order before attributing one to the OS.

#### Fixed: PAM sessions had no `/usr/local/bin`, so publisher could not find quarto

The chain, every link measured on a Rocky stack:

1. rserver launches sessions through **PAM**, which builds a fresh environment
   instead of inheriting the container's. Proof: the image's `ENV PATH` contains
   `/usr/local/bin` *twice*, yet the extension host's PATH contained none of the
   image's entries. **Putting a directory on PATH in the Dockerfile therefore does
   not reach a session** -- it only affects `docker exec` and PID 1.
2. `pam_env` (present in `/etc/pam.d/system-auth` on EL9) takes that PATH from
   `/etc/environment`. Debian/Ubuntu ship a populated one; **EL9 ships it empty**.
3. So the Rocky extension host's PATH lacked `/usr/local/bin`, where the image
   installs quarto. Measured before the fix:
   `.../remote-cli:/home/user1/.local/bin:/home/user1/bin:/usr/share/Modules/bin:/sbin:/bin:/usr/sbin:/usr/bin:/bin:/usr/local/sbin`
   -- note `/usr/local/sbin` but no `/usr/local/bin`.
4. Publisher runs `execFile("quarto", ["inspect", <file>])` -- **by name**, so
   PATH-dependent. On failure it logs `attempting fallback` and writes its
   hardcoded `fZ = "1.7.34"` with `engines: []`.
5. Connect keys R provisioning off those engines, so it never puts
   `/opt/R/4.6.1/bin` on the render's PATH and `quarto render` dies with
   `Failed to spawn 'Rscript'`.

The installer now writes `/etc/environment` on Rocky (only when it has no `PATH`
line). Verified at every level afterwards: the ext host PATH gains
`/usr/local/bin`; `quarto inspect` succeeds in a session-like minimal env
(`engines: ["knitr"]`); publisher records `version = "1.10.18"` with
`engines = ["knitr"]`; and the test passes on Rocky.

**Trap that cost two runs:** `.posit/publish/*.toml` persists in the container
between runs and publisher reuses it, so the first runs after the fix still used
the stale `engines: []` config and looked like failures. The fixture re-tars
`test-files` in each session but tar does not delete extra files. Remove
`.posit` when iterating on a publisher test. Separately, the very first run after
deleting it failed in the publisher UI (a `not.toBeVisible` predicate, never
reaching Connect) and passed on the next run, so the first-time
config-creation path looks flaky independently of this bug.

#### Second CI run: both fixes confirmed on the lane

Rocky lane went from **42 passed / 3 failed / 1 flaky** to **46 passed / 2 failed**,
from a fresh install (so the installer's `/etc/environment` write is exercised, not a
hand-applied file). `publisher-quarto-r`, `files-pane-refresh`, `publisher-shiny` and
`environment-modules` (R) all pass.

The two remaining failures are both already characterised as not lane work:

- `environment-modules` (Python) -- [#15509](https://github.com/posit-dev/positron/issues/15509).
- `posit-assistant-signin` `openai-api` -- the pre-existing assistant flake. It flaked
  on Rocky in run 1, was the only `workbench-stable (default)` failure in run 1, and
  passed on `workbench (default)` and every stable shard in this run.

Regression check stayed clean: `workbench (default)` 46 passed / 0 failed, every
`workbench-stable` shard green. (`workbench (databricks)` failed once on
`managed-credentials-databricks`, an Ubuntu credential shard this work does not touch,
which passed in run 1 and on `workbench-stable (databricks)` in the same run.)

**Operational note for anyone iterating on this PR:** a push cancels in-progress checks
on this repo. A docs-only commit cancelled a Rocky lane job seven minutes from
answering this exact question, costing a full ~60-minute cycle. Batch plan/body edits
with code, or wait for the run.

#### Also measured: the duplicate-rserver bug is real, and the suite causes it

After one suite run the Rocky container had **three** rservers: the original from
the install, plus one per `sudo rstudio-server restart` in
`enforced-settings-language-scoped.test.ts`. `rserver.log` then fills with
`Error response from monitor request: 401` from the duplicates contending for the
monitor socket.

Two corrections to earlier revisions of this document. First, the enforced-settings
tests **pass** -- the prediction that they would fail was wrong, and consistent
with the corrected model that resolution happens at session launch rather than
being cached at rserver startup. Second, this is not only the harness's resume
path: **test code** produces it, twice per run, with exit status 0. So the
signal-stop -> verify -> start mitigation is worth doing before the lane is
promoted, purely so later diagnosis isn't done against a wedged process tree. It
is deliberately **not** bundled into this PR -- a botched stop/start would break
both lanes at once.

#### Bug found on the way: the local harness ran a different Ubuntu image than CI

`wb_os_image ubuntu24` was pinned to `positron-ubuntu24:24.15.0` while
`docker-compose.workbench.yml` had moved to `24.18.0` (#15243 bumped Compose;
#15429 then added the function with the stale tag). So `--os=ubuntu24` silently
ran an older image than a bare `docker compose up` or CI -- exactly the kind of
difference that makes a local repro of a CI failure disagree for no visible
reason. Fixed, with a comment tying the two copies together. The durable fix is
for `update-ci-images` to bump *consumers* of a published tag and not just
`NODE_VERSION` in the image-build compose files; it does not today.

### Step 5 (original plan text, for reference)

**Iteration gotcha, learned the hard way in Step 4:** do not edit
`workbench-local.sh` (or any script) while a run of it is in flight. Bash reads a
script incrementally by byte offset, so inserting lines mid-run makes it resume
at a shifted offset -- in practice it re-entered `main` and installed everything
a second time. The symptom (every log line appearing exactly twice, two
`docker exec` installers from one script pid) looks exactly like a harness bug
and is not one. Let the run finish, or `Ctrl-C` first.

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

### Step 6 -- The `@:workbench-rocky` tag (DONE)

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

### Step 7 -- CI wiring (DONE)

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

Surfaced by this work, roughly in order of value:

- **Fix the duplicate-rserver bug** (`setup-workbench-docker/action.yml`'s trailing
  `sudo rstudio-server restart`, and the same call in
  `enforced-settings-language-scoped.test.ts`). Measured: three rservers after one
  Rocky suite run, `rserver.log` filling with monitor `401`s, exit status 0
  throughout. Replace with signal-stop -> verify -> start, ideally via a small
  sourceable helper shared with `install-workbench.sh`'s `stop_rserver` /
  `start_workbench` rather than a third copy. Do it on its own, since a botched
  stop/start breaks both lanes at once.
- **Pin Quarto in the image Dockerfiles.** `ubuntu24_04`, `rocky_8`, `rocky_9` and
  `debian` all fetch `quarto.org/download/latest`, so each image freezes whatever
  was current on its build date and a rebuild can change Quarto with no diff. The
  *build* lane already pins it (`v1.10.18`), so the images are the odd ones out.
- **Teach `update-ci-images` to bump consumers of a published tag**, not just
  `NODE_VERSION` in the image-build compose files. `wb_os_image` drifting from the
  Compose default (24.15.0 vs 24.18.0) came from exactly that gap, and the same
  gap covers `test-e2e-rhel.yml`'s pin and the ci-arm lab images.
- **Track [#15509](https://github.com/posit-dev/positron/issues/15509)** and drop
  the `@:environment-modules` Python failure from the expected-failures list once
  it lands. The issue carries two comments on how to test it so it fails on Ubuntu
  too, which is what stops it regressing.

From the original plan:

- Promote the Rocky lane into the nightly / full-suite run, once it is green.
- The Rocky 9 Dockerfile simplifications (drop the source GEOS/GDAL/libgit2
  builds and `gcc-toolset-13`).
- Add the credential shards to the Rocky lane.
- Consider migrating `test-e2e-rhel.yml` from `positron-rocky8` to
  `positron-rocky9` so we maintain one Rocky image, not two.
