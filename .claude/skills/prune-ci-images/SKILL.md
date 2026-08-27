---
name: prune-ci-images
description: Audit old container images in the posit-dev GHCR registry and delete them in a reviewed batch. Produces a review list of every positron-<os>* / positron-postgres-* image version older than a cutoff (default 90 days), excluding anything a live tag or multi-arch manifest still points at; the human deletes rows they want to keep, then this drives the batch delete. Use when asked to clean up, prune, or garbage-collect old GHCR packages/images.
---

# Prune old CI images from GHCR

Two-phase, human-gated cleanup of stale container versions in
`https://github.com/orgs/posit-dev/packages`:

1. **Audit** (read-only) -> a markdown review list of deletion candidates.
2. **Human review** -> the reviewer removes rows they want to KEEP.
3. **Prune** -> batch-delete exactly the rows that remain.

`<dir>` below means `.claude/skills/prune-ci-images`.

**Deletion is disruptive and only conditionally recoverable.** GitHub can
usually restore a deleted package version within **30 days**, provided the
package still exists and that version/tag has not been re-pushed:

```bash
gh api -X POST /orgs/<org>/packages/container/<pkg>/versions/<id>/restore
```

Do not rely on that. Restoring is manual and per-version, and it does nothing
about the immediate breakage: any workflow or branch pinning a deleted tag
fails as soon as the version goes away. Never run the prune step with
`--confirm` until the human has explicitly approved the reviewed list.

## Preflight

```bash
gh auth status          # needs read:packages AND delete:packages
```

`read:packages` alone is enough for the audit. The prune step checks for
`delete:packages` itself and refuses to run without it. To add it:

```bash
gh auth refresh -h github.com -s read:packages -s delete:packages
```

The token also needs to be for an account with admin rights on the packages;
org member read access is not sufficient to delete.

## Phase 1 -- Audit

```bash
<dir>/scripts/ghcr-audit.sh \
  --repo-path "$REPO" \
  --out /tmp/ghcr-review-list.md
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--org` | `posit-dev` | Org that owns the packages |
| `--age-days` | `90` | Candidates must be older than this |
| `--pattern` | see below | ERE matched against package names |
| `--repo-path` | none | Checkout to scan for in-use image tags |
| `--protect-tag` | none | Extra tag to treat as in-use (repeatable) |
| `--out` | stdout | Where to write the review list |

Default pattern:

```
^positron-(postgres|ubuntu|rocky|debian|opensuse|sles|windows|amazonlinux|fedora|alpine|centos)
```

This deliberately covers the OS images and postgres images (both the multi-arch
index packages like `positron-rocky8` and the per-arch ones like
`positron-rocky8-amd64`), and deliberately **excludes** other `positron-*`
packages that are not OS images: `positron-builds-rocky8`, `positron-ci`,
`positron-sagemaker`, `positron-debian13` variants are covered, but
build/tooling images are not. Widen with `--pattern` only on request.

Always pass `--repo-path`. Without it nothing is treated as in-use and live
tags land in the candidate list.

### What the audit protects automatically

A version is **retained** (never listed) when:

- it is newer than the cutoff, or
- one of its tags is referenced as `ghcr.io/<owner>/<pkg>:<tag>` under
  `.github/`, `docker/`, `test/`, `scripts/`, or `build/` in `--repo-path`, or
- it is a child manifest of a retained multi-arch index. The audit resolves
  every retained version against the ghcr.io registry API and protects the
  per-arch digests it points at. These appear in an
  "Excluded: children of retained images" section of the report.

That last rule is the one that matters most. The multi-arch build pushes an
index plus two **untagged** per-arch manifests into the same package, all in the
same second. The untagged rows look like garbage but deleting them breaks the
tagged image.

### Reading the report

- **"Packages that would be emptied completely"** -- every version of these is a
  candidate, so GHCR will hide the package entirely. Surface this list to the
  user explicitly and confirm the image is retired before deleting.
- **"Warning: manifests that could not be resolved"** -- registry reads failed,
  so the protected set may be incomplete. Do not proceed on a list with this
  section; fix access and re-run.
- **`kind` column** -- `tagged`, `untagged` (an orphaned index whose tag moved
  away), or `arch child` (a per-arch manifest under a candidate index).
- **`group` column** -- ties an index to its children. Rows sharing a group must
  be kept or deleted together.

## Phase 2 -- Human review

Hand the file to the user and state plainly:

- how many candidates there are and the cutoff used,
- which packages would be emptied entirely,
- that **every row listed will be deleted**, and they should **delete the rows
  they want to keep**,
- that rows sharing a `group` must be kept or removed as a unit,
- that `id` and `group` columns must not be edited.

Wait for the user to confirm the reviewed file. Do not guess at approval.

## Phase 3 -- Prune

Dry run first, always. Pass the **same** `--repo-path` used for the audit:

```bash
<dir>/scripts/ghcr-prune.sh --list /tmp/ghcr-review-list.md --repo-path "$REPO"
```

The prune step does not trust the review list. Time passes between the audit and
the human's approval, so it re-derives safety from the live registry and
**aborts** on any of:

1. **Unreadable state** -- a package's versions or any manifest in an involved
   package cannot be read. Every check **fails closed**: an unresolvable
   manifest is never treated as "has no children", because that is exactly how
   a live per-arch manifest would get deleted.
2. **Tag drift** -- a listed version's tags no longer match what the audit
   recorded. This is the retag case: a digest that was garbage at audit time has
   since been given a tag and put back into use.
3. **Now in use** -- a listed version's tag is referenced in `--repo-path` (or
   `--protect-tag`). Catches a tag that became load-bearing after the audit.
4. **Still referenced by a retained index** -- the protected set is recomputed
   from scratch as the children of every version *not* listed for deletion.
5. **Split group** -- a listed index has a child that is no longer listed. Fix
   the list rather than reaching for `--allow-split-group`.

Versions that no longer exist are reported and skipped, not treated as errors,
so a partially completed run is safe to re-run with the same list.

If it aborts, relay the reason and re-run `ghcr-audit.sh` to regenerate the list
rather than hand-editing around the check.

Then, only after explicit user approval:

```bash
<dir>/scripts/ghcr-prune.sh --list /tmp/ghcr-review-list.md --repo-path "$REPO" --confirm
```

It deletes one version at a time, prints a line per deletion, and exits non-zero
with a failure summary if any call fails.

## After pruning

Report deleted/failed counts per package. If a package was emptied, note that it
no longer appears in the org package list. Nothing in the repo needs updating --
the audit already refused to touch tags the repo references.

## Known limits

- The in-use scan reads the **working tree only**. Tags referenced solely by an
  older release branch, a reverted commit, or an external repo are invisible to
  it. For anything load-bearing, pass `--protect-tag` or keep the row.
- The scan matches **literal** `ghcr.io/<owner>/<pkg>:<tag>` text. Image
  references assembled at runtime are not detected, and this repo has several,
  e.g. `ci-images-build-os.yml` builds
  `ghcr.io/${OWNER}/positron-${OS_TAG}-${ARCHITECTURE}:${{ inputs.tag }}`.
  Those happen to be push targets rather than pins, so they do not put an old
  version at risk -- but a consumer built the same way would be missed. If a tag
  is referenced only through a variable, pass `--protect-tag`.
- GHCR reports no pull statistics through this API, so "last pulled" cannot
  inform the cutoff. Age is the only signal available.
- Untagged versions in *per-arch* packages (`positron-rocky8-amd64`) are not
  cross-repo children of the index packages; OCI indexes reference digests in
  their own repository. Deleting old per-arch versions does not break the
  corresponding `positron-rocky8:<tag>` index.
