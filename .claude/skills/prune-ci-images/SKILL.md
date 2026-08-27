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

**Deletion is irreversible.** A deleted version cannot be restored, and any
workflow or branch pinning that tag breaks. Never run the prune step with
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

Dry run first, always:

```bash
<dir>/scripts/ghcr-prune.sh --list /tmp/ghcr-review-list.md
```

It parses the table, re-resolves every listed version against the registry, and
**aborts** if a listed index has a child that is no longer listed (a split
group). Fix the list rather than reaching for `--allow-split-group`.

Then, only after explicit user approval:

```bash
<dir>/scripts/ghcr-prune.sh --list /tmp/ghcr-review-list.md --confirm
```

It deletes one version at a time, prints a line per deletion, and exits non-zero
with a failure summary if any call fails. Failures are safe to retry -- already
deleted ids return 404 and are reported as failures, so re-run with a list
trimmed to what remains, or just report the failures.

## After pruning

Report deleted/failed counts per package. If a package was emptied, note that it
no longer appears in the org package list. Nothing in the repo needs updating --
the audit already refused to touch tags the repo references.

## Known limits

- The in-use scan reads the **working tree only**. Tags referenced solely by an
  older release branch, a reverted commit, or an external repo are invisible to
  it. For anything load-bearing, pass `--protect-tag` or keep the row.
- GHCR reports no pull statistics through this API, so "last pulled" cannot
  inform the cutoff. Age is the only signal available.
- Untagged versions in *per-arch* packages (`positron-rocky8-amd64`) are not
  cross-repo children of the index packages; OCI indexes reference digests in
  their own repository. Deleting old per-arch versions does not break the
  corresponding `positron-rocky8:<tag>` index.
