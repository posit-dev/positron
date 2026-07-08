---
name: update-ci-images
description: Long-running orchestration to rebuild every Positron CI image (ubuntu24_04, rocky_8, debian, openSUSE15_6, SLES15_6, and postgres — each as a multi-arch amd64+arm64 manifest) at one new tag with a new Node version. Creates a branch + PR, bumps NODE_VERSION, dispatches the build workflows on that branch with bounded concurrency, monitors the runs, auto-fixes failures and retries, and leaves the PR open for human review once all 6 builds are green.
---

# Update all CI images

Rebuild every CI image at a single new tag with a new Node.js version,
driving the existing `workflow_dispatch` build workflows from a PR branch and
babysitting the runs until they all pass.

## Inputs

Parse from the user's invocation (ask only if missing):

- **tag** (required) — the Docker tag every image gets, e.g. `2025.06.0`.
- **node version** (required) — full Node version, e.g. `22.22.1` (must exist at
  `https://nodejs.org/dist/v<version>/` for both x64 and arm64).
- **concurrency N** (optional, default **4**) — max build jobs in flight at once.

## The job matrix — 6 builds total

| Workflow | Variants |
|---|---|
| `ci-images-build-os.yml` | `os` in {ubuntu24_04, rocky_8, debian, openSUSE15_6, SLES15_6} = **5** |
| `ci-images-build-postgres.yml` | postgres = **1** |

Each workflow run builds **both** architectures (amd64 + arm64) as a matrix on native
runners and then merges them into a single multi-arch **manifest list**, e.g.
`ghcr.io/<owner>/positron-ubuntu24:<tag>`, `positron-postgres:<tag>`. There is one run
(one dispatch) per image, not per architecture. The per-arch tags
(`positron-ubuntu24-amd64:<tag>`, `positron-ubuntu24-arm64:<tag>`, …) are **still pushed**
as build outputs and left in place for the transition — the manifest list is assembled
from them by the workflow's `merge` job. Postgres has no Node and gets **no**
`NODE_VERSION` change.

`<dir>` of this skill below means `.claude/skills/update-ci-images`.

---

## Phase 0 — Preflight

Run and confirm all pass before changing anything:

```bash
gh auth status                       # authenticated, has workflow + repo scope
git -C "$REPO" status --porcelain     # MUST be empty (clean tree)
git -C "$REPO" rev-parse --abbrev-ref HEAD   # report the base branch (any is fine)
gh repo view --json nameWithOwner -q .nameWithOwner   # expect posit-dev/positron
```

- Verify the Node version exists for both arches (HEAD request is enough):
  `curl -sfI https://nodejs.org/dist/v<node>/node-v<node>-linux-x64.tar.xz` and
  `...-linux-arm64.tar.xz`. If either 404s, **stop** and tell the user the version is bad.
- The tree MUST be clean — if dirty, stop and ask how to proceed.
- The base branch does **not** have to be `main`. The `update-images/<tag>` branch forks
  from wherever you are, which is fine for testing off a feature branch. Just report which
  base branch you're forking from (and note it in the PR body) so it's not a surprise.

## Phase 1 — Branch, bump, PR

```bash
git -C "$REPO" switch -c update-images/<tag>          # sanitize <tag>: non-alnum -> '-'
bash <dir>/scripts/bump-node-version.sh <node>        # edits all 10 compose files, prints proof
# NB: the R PPM snapshot pin is a SEPARATE knob (PPM_SNAPSHOT arg, bumped by
# scripts/bump-ppm-snapshot.sh) and is NOT changed on a normal Node rebuild.
# See the "PPM latest publish-window race" note in Phase 4 before touching it.
git -C "$REPO" add -A
git -C "$REPO" commit -m "Bump Node to <node> and rebuild all images at <tag>"
git -C "$REPO" push -u origin HEAD
gh pr create --base main --head update-images/<tag> \
  --title "Rebuild all CI images at <tag> (Node <node>)" \
  --body  "<see template below>"
```

PR body template — fill the checklist; you will tick boxes as builds go green:

```
Rebuilds every image at tag `<tag>` with Node `<node>`.

Driven by the `update-ci-images` skill. Builds are dispatched on this branch
via workflow_dispatch with max <N> jobs in flight.

### Builds (each is a multi-arch amd64+arm64 manifest)
- [ ] ubuntu24_04
- [ ] rocky_8
- [ ] debian
- [ ] openSUSE15_6
- [ ] SLES15_6
- [ ] postgres
```

Commit the end-of-message PR/commit trailer convention used in this repo.

> **Updating the PR body/checklist:** use the REST API, **not** `gh pr edit`. `gh pr edit
> --body` can fail with a Projects-classic GraphQL deprecation error and silently leave the
> body unchanged, so use the REST PATCH which is unaffected:
> ```bash
> gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f body="$NEW_BODY"
> ```
> Rebuild the full body text (with the updated checkboxes) and PATCH it each time.

## Phase 2 — Build the queue and state

Create a state file in the scratchpad to survive the long run. Track every job as
`queued` → `running` (with its run id) → `done`/`failed`. Keep **two** independent
per-job counters (see Phase 4 for why):
- `fix_attempts` — times a *real* code fix was made and the job re-dispatched.
- `transient_retries` — times the job was re-dispatched for an infra flake (no code change).

Use a TodoWrite list mirroring the 6 jobs so progress is visible.

The 6 jobs (name them like the checklist rows). For each you'll call
`dispatch-job.sh <branch> <tag> [os]` — pass `os` for the 5 OS jobs, omit it
for the postgres job. Each job dispatches one run that builds both arches and
merges them into a manifest list.

## Phase 3 — Dispatch + monitor loop (the long-running part)

Maintain `in_flight` (run id → job) and `queued`. Loop until `queued` is empty and
`in_flight` is empty:

1. **Refill:** while `len(in_flight) < N` and `queued` non-empty, pop a job and:
   ```bash
   id=$(bash <dir>/scripts/dispatch-job.sh <branch> <tag> [os])
   ```
   Record `id`, mark the job `running`, increment its `attempts`. Update the state file.

2. **Wait:** launch the waiter in the **background** so it doesn't block the session,
   passing every in-flight run id (poll every 60s). On macOS wrap it in `caffeinate -i`
   so the host doesn't idle-sleep mid-run (the builds run on GitHub, but if the host
   sleeps this poll loop stalls and you won't get re-invoked until it wakes):
   ```bash
   # macOS: prevent idle sleep while waiting. (Linux: drop caffeinate, or use
   # `systemd-inhibit --what=idle`.) NB: caffeinate -i does NOT stop lid-close
   # sleep on battery — only idle sleep.
   WAIT="bash <dir>/scripts/wait-for-runs.sh 60 <id1> <id2> ..."
   if [ "$(uname)" = "Darwin" ]; then caffeinate -i $WAIT; else $WAIT; fi
   ```
   It exits and prints `<id> <conclusion>` lines as soon as any in-flight run completes;
   the harness re-invokes you with that output.

3. **Handle completions** for each printed line:
   - `success` → mark job `done`, remove from `in_flight`, tick its PR checklist box
     (via `gh api -X PATCH`, see Phase 1 note) and TodoWrite item. Go back to step 1 to refill.
   - anything else (`failure`/`cancelled`/`timed_out`/`startup_failure`) → go to Phase 4.

4. When `queued` and `in_flight` are both empty → Phase 5.

> Do not poll with foreground `sleep`. Use the background waiter (step 2); the harness
> re-invokes you when it exits. While waiting you may also use the Monitor tool.

## Phase 4 — Diagnose, fix, retry a failed build

For a failed run id:

```bash
gh run view <id> --log-failed     # the failing step + error
```

Each run has two `build` matrix legs (amd64, arm64) plus a `merge` job. `--log-failed`
shows which leg (arch) failed — use it to pick the right file to edit (the per-arch
`docker/images/<os>/docker-compose.<arch>.yml` or the shared `docker/images/<os>/Dockerfile.*`). A `merge`-job
failure means a leg didn't push its arch tag (so the leg is the real failure — fix that),
or a transient GHCR/`imagetools` blip (re-dispatch). Re-dispatching rebuilds **both**
arches and re-merges; that's expected.

Classify by the **failure signature** (the failing step + error), not just the job:

- **Transient** (runner lost, network blip, GHCR 5xx, "no space left", `setup-qemu`
  flakes, a CTAN/mirror fetch failure, even a flaky `gh` call): no code change.
  Re-dispatch the same job (push not needed), put it back in `in_flight`, and bump
  `transient_retries` (allow up to **5** — flakes are not the job's fault).
- **Real build error** (package/repo not found, Node 404 for an arch, Dockerfile/compose
  problem, a base-image or upstream-package change): edit the relevant file
  (`docker/images/<os>/Dockerfile.*`, `docker/images/<os>/docker-compose.<arch>.yml`, or `docker/images/postgres/Dockerfile.postgres`),
  keeping the change minimal and matching surrounding style. Then:
  ```bash
  git -C "$REPO" add -A
  git -C "$REPO" commit -m "Fix <os>/<arch> build: <what>"
  git -C "$REPO" push
  ```
  Re-dispatch the job on the (now updated) branch, put it back in `in_flight`, and bump
  `fix_attempts`.
- A Node-version 404 for one arch usually means a bad input — **stop** and report; don't
  burn retries.

**Counting matters — track per *root cause*, not per job.** A single job can hit several
*distinct* failures in a row (e.g. a real error, then a separate infra flake). Reset/scope
the relevant counter to the failure signature so one issue's budget isn't eaten by another.

**Stop condition:** pause the loop and escalate when, for one job, **`fix_attempts` reaches
3 for the same failure signature** (a real fix isn't working), OR `transient_retries`
reaches 5 (persistent flakiness), OR the failure is **ambiguous / its fix changes image
contents in a way the owner should decide** (e.g. pinning package versions). When pausing,
report: the job, the failing step, what you tried, and the `gh run view <id> --log-failed`
excerpt. Let other in-flight/queued jobs continue; only the stuck job blocks final success.
Don't loop forever.

A fix pushed to the branch only affects builds dispatched *after* the push. Jobs already
in flight keep the old code — that's fine; let them finish and judge them on their own merits.

### Known failure patterns (fixes already proven on this repo)

- **R source package needs a newer system lib than the distro ships** (e.g. `terra` 1.9
  needs GDAL ≥ 3.7 but Debian bookworm has 3.6.2 → `gdal_multidimensional.cpp ... no
  matching function for ... AsClassicDataset`). Fix: pin the dev-deps install to a dated
  PPM snapshot from *before* the breaking package version, for that OS's `R_REPO`/`RSPM`:
  `https://packagemanager.posit.co/cran/<DATE>` (source) and
  `https://packagemanager.posit.co/cran/__linux__/<distro>/<DATE>` (binary). Find the
  breaking date from `https://cran.r-project.org/src/contrib/Archive/<pkg>/`. (Rocky takes
  a different route — it builds newer GEOS/GDAL from source — so this only bites Debian-ish.)
- **PPM `latest` publish-window race** (`! Failed to download <pkg> from
  https://packagemanager.posit.co/cran/.../latest/.../<pkg>_<ver>.tar.gz` during
  `pak::local_install_dev_deps`, after many packages downloaded fine). Root cause: on the
  rolling `latest` channel, pak resolves a version from the `PACKAGES` metadata but the
  matching binary/source file can already have rotated out of `latest` mid-publish → an
  intermittent 404. It looks transient but recurs. Fix: pin the **build-time** dev-deps
  install to a dated snapshot (`https://packagemanager.posit.co/cran/<DATE>` source,
  `.../cran/__linux__/<distro>/<DATE>` binary), which is internally consistent. Leave each
  image's runtime `.Rprofile`/`ENV RSPM` on `latest`. The date is the **`PPM_SNAPSHOT`
  build arg**, set per-OS in the `docker/images/<os>/docker-compose.*.yml` files and consumed
  by each `Dockerfile.*`. Bump the four rolling OSes with `scripts/bump-ppm-snapshot.sh <DATE>`;
  **debian is intentionally excluded** (frozen at `2026-03-01` for the terra/GDAL reason
  above — do not move it with the others). Ref: posit-dev/positron#14613. Changing image
  contents (package versions) is an owner decision — confirm the date with the user before
  repinning.
- **TinyTeX / `tlmgr` intermittent failures** (`could not get texlive.tlpdb`, or install
  fails after fetching from a random mirror). Root cause: `tlmgr option repository
  https://mirror.ctan.org/...` is a round-robin that can land on a stale/unreachable
  mirror per call. Fix: pin to a single complete mirror
  (`https://ctan.math.illinois.edu/systems/texlive/tlnet`) and wrap the network-dependent
  `tlmgr update`/`install` in a small retry loop. Present in all 5 OS Dockerfiles.

## Phase 5 — Finish

When all 6 are `done` (success):

- Tick all PR checklist boxes (`gh api -X PATCH`, per the Phase 1 note); add a summary
  comment (`gh pr comment <n>` works fine) listing each manifest:tag pushed, e.g.
  `ghcr.io/posit-dev/positron-ubuntu24:<tag>` … `positron-postgres:<tag>` (the per-arch
  `-amd64`/`-arm64` tags are also pushed as build outputs).
- **Leave the PR open for human review — do NOT merge.**
- Report to the user: the PR URL, the tag, the Node version, and confirmation that all
  6 multi-arch images built and pushed. Note anything that needed a fix (link those commits).

If you stopped early on a stuck job, report exactly what's green, what's blocked, and the
diagnosis, and leave the branch/PR in place for the user to take over.
