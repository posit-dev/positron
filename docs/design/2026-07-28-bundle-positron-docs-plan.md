# Bundled Positron docs on disk: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-07-27 design spec](./2026-07-27-bundle-positron-docs-design.md) (revision 7). Read the spec's
"Behaviour" and "Failure modes" sections before starting Part B.

**Goal:** Publish a slim LLM-only docs bundle from `posit-dev/positron-website`, and give Positron's
extension host a `positron.docs.getLocalDocs()` API that downloads, verifies, caches, and advertises
that bundle so the AI assistant can read docs from disk instead of fetching `positron.posit.co`.

**Architecture:** All decision logic lives in a host-agnostic `src/vs/platform/positronDocs/common/`
module behind three injected ports (HTTP, file store, archive), so the whole state machine is
unit-testable with no DI container and no node imports. A thin extension-host service in
`src/vs/workbench/api/node/positron/` constructs the real ports, derives its inputs from init data,
owns the triggers, and delegates. The web-worker extension host gets a variant that always returns
`undefined`.

**Tech Stack:** TypeScript (ESM, tabs), Vitest for unit tests, node `https`/`crypto`/`fs` and
`base/node/zip.ts` in the adapter layer, GitHub Actions + AWS CLI + `zip`/`shasum` on the website side.

## Scope

| Covered | Not covered |
|---|---|
| Part A: website slim bundle (spec Rollout step 1) | PR 2c, the gating `e2e-electron` test (spec Rollout step 4) |
| Part B: Positron PR 2a, the platform module (spec Rollout step 2) | The contract-check script + weekly workflow (spec Rollout step 5) |
| Part C: Positron PR 2b, the extension-host wiring (spec Rollout step 3) | The assistant read path in `posit-dev/assistant` (spec Step 3) |

Part A is executed from a **`posit-dev/positron-website` checkout**, not from this repo. Parts B and C
are executed on the `mi/bundle-docs` branch of this repo, one commit per task, split into two PRs at
push time along the Task 7 / Task 8 boundary.

## Global Constraints

Every task's requirements implicitly include this section.

- **Indentation:** tabs in all TypeScript/JavaScript. Two spaces in YAML.
- **ASCII only.** No em-dashes, en-dashes, smart quotes, or other non-ASCII punctuation anywhere,
  including comments and log strings. Use ASCII hyphens and straight quotes.
- **Copyright header** on every new TypeScript file in this repo:
  ```
  /*---------------------------------------------------------------------------------------------
   *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
   *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
   *--------------------------------------------------------------------------------------------*/
  ```
- **Never run `npx tsc` / `tsc --noEmit` against `src/tsconfig.json`.** Use `npm run build-check`
  (blocks until daemons finish; do not `sleep` first). For `.vitest.ts` type errors use
  `npm run test:positron:check-ts`.
- **Vitest assertion style:** `expect(x).to*(...)`. Never `assert.ok` / `assert.equal` /
  `assert.strictEqual`.
- **Vitest files** carry `/// <reference types="vitest/globals" />` on the line after the copyright
  header, and live under a `test/` directory mirroring the source layer (`common/` -> `test/common/`).
- **Wide-interface partial stubs** use `stubInterface<T>(overrides)` from
  `src/vs/test/vitest/stubInterface.ts`, never `{...} as unknown as T`.
- **Upstream edits** are wrapped in `// --- Start Positron ---` / `// --- End Positron ---` with a
  one-line reason. Only two upstream files change in this plan:
  `src/vs/workbench/api/node/extHost.node.services.ts` and
  `src/vs/workbench/api/worker/extHost.worker.services.ts`.
- **Prefer `async`/`await` over `.then()`** (Positron team convention). Where a constructor needs an
  async subscription, call a named private `async` helper and ignore its promise deliberately.
- **Commit staging:** never `git add -A` in this worktree (a `node_modules` symlink gets tracked).
  Stage explicit paths.
- **Precommit:** run `npm run precommit -- <files>` before each commit in Parts B and C.
- **Exact string constants** used across Parts A, B and C, which must match verbatim:
  - Bundle basename, `positron` profile: `positron-llms`
  - Bundle basename, `workbench` profile: `positron-workbench-llms`
  - Zip name: `<basename>-<version>.zip`, alias `<basename>-latest.zip`
  - Sidecar name: `<zipname>.sha256sum`
  - `bundle.json` schema value: `1`
  - Default CDN base: `https://cdn.posit.co/positron/releases/docs`
  - Env override: `POSITRON_LLMS_DOCS_URL`
  - `product.json` field: `positronLlmsDocsUrl`
  - Log prefix: `[positron-docs]`
  - Cache dir name: `positron-docs`, state file `state.json`

## File Structure

**Part A - `posit-dev/positron-website`**

| File | Responsibility |
|---|---|
| `scripts/build-llms-bundle.sh` (create) | Given a rendered site dir + profile + version, emit the slim zip, its `bundle.json`, and its `.sha256sum`. Runs every content guard. Locally runnable. |
| `.github/workflows/release-docs-bundles.yml` (modify) | Call the script per profile, upload sidecar-then-zip-then-alias, set `Cache-Control`, assert the published objects. |

**Part B - Positron PR 2a, `src/vs/platform/positronDocs/`**

| File | Responsibility |
|---|---|
| `common/positronDocsBundle.ts` (create) | Pure types + `resolveBundleRequest()` + `parseManifest()` + shared constants. No I/O. |
| `common/positronDocsPorts.ts` (create) | The three port interfaces and the `ILocalDocsResult` shape. Types only. |
| `common/positronDocsValidate.ts` (create) | Digest comparison, zip-entry traversal guard, extracted-bundle validation. Port-using, no state. |
| `common/positronDocsCache.ts` (create) | `PositronDocsCache` - the orchestrator and the whole state machine. |
| `test/common/fakes.ts` (create) | In-memory fakes for the three ports, shared by the cache tests. |
| `test/common/positronDocsBundle.vitest.ts` (create) | Table-driven resolution + manifest parsing. |
| `test/common/positronDocsValidate.vitest.ts` (create) | Guard and validation coverage. |
| `test/common/positronDocsCache.vitest.ts` (create) | The state machine, including the cache-present rule per failure kind. |

**Part C - Positron PR 2b**

| File | Responsibility |
|---|---|
| `src/vs/workbench/contrib/positronAssistant/common/positronAIConfigurationKeys.ts` (create) | Side-effect-free home for `AI_ENABLED_KEY`, importable from the extension host. |
| `src/vs/workbench/contrib/positronAssistant/common/positronAIConfiguration.ts` (modify) | Re-export the constant from its new home; keep the `registerConfiguration` side effect here. |
| `src/vs/base/common/product.ts` (modify) | Declare `positronLlmsDocsUrl?: string` in the existing Positron block. |
| `product.json` (modify) | Ship the default CDN base. |
| `src/positron-dts/positron.d.ts` (modify) | Declare `namespace docs`. |
| `src/vs/workbench/api/common/positron/extHostDocs.ts` (create) | `IExtHostDocs` decorator + interface + `WorkerExtHostDocs`. |
| `src/vs/workbench/api/node/positron/extHostDocsNode.ts` (create) | `NodeExtHostDocs`: real port adapters, input derivation, triggers. |
| `src/vs/workbench/api/worker/extHost.worker.services.ts` (modify) | One `registerSingleton` line. |
| `src/vs/workbench/api/node/extHost.node.services.ts` (modify) | One `registerSingleton` line. |
| `src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts` (modify) | Assemble and return the `docs` namespace. |
| `src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts` (create) | Trigger logic and gating. |

## Findings from codebase reconnaissance that adjust the spec

Read these before starting. Each one changes code the spec described differently.

1. **`IExtHostConfiguration.getConfigProvider()` is async and barrier-gated.** `onDidChangeConfiguration`
   lives on the returned `ExtHostConfigProvider`, not on the service. Every `ai.enabled` read is
   therefore `await`-ed. Model: `src/vs/workbench/api/node/extHostSearch.ts:39-82`.
2. **`AI_ENABLED_KEY`'s module has a top-level `registerConfiguration()` side effect.** Importing
   `positronAIConfiguration.ts` from the extension host would pull the configuration registry into the
   ext-host bundle and re-register the `ai` config node in that process. Task 8 extracts the constant
   into a side-effect-free sibling module first. The import itself is legal:
   `eslint.config.js`'s `src/vs/workbench/api/~` target allows `vs/workbench/contrib/*/~`.
3. **The worker-variant naming convention is `Worker*`, not `*Unsupported`.** No class named
   `*Unsupported` exists in `src/vs/workbench/api/`. Model: `WorkerExtHostTerminalService`
   (`extHostTerminalService.ts:1283`). The spec's `ExtHostDocsUnsupported` becomes `WorkerExtHostDocs`.
   Its `getLocalDocs()` returns `undefined` rather than throwing `NotSupportedError`, because
   `undefined` is the documented "no local docs, use the web" contract.
4. **Both service registrations are mandatory, not optional.**
   `createPositronApiFactoryAndRegisterActors` is `invokeFunction`'d from the node host
   (`api/node/extHostExtensionService.ts:162`) *and* the worker host
   (`api/worker/extHostExtensionService.ts:55`). A node-only registration crashes the worker host at
   startup. Neither services file has an existing Positron block, so both get fresh markers.
5. **Use `isWorkbench` from `src/vs/base/common/platform.ts:167`, not a raw `RS_SERVER_URL` read.**
   That constant already is `!!nodeProcess?.env['RS_SERVER_URL']` on the node side
   (`platform.ts:169`), which is exactly the spec's rule.
6. **`pfs` has no `readFile`, `mkdir`, or plain `stat`.** `src/vs/base/node/pfs.ts` exports
   `Promises.{exists,readdir,writeFile,rm,rename,copy,realpath}`. Use `fs.promises` directly for
   `readFile`, `mkdir`, and `stat` - pfs itself does (`pfs.ts:632`).
7. **`extract()` takes a required positional `CancellationToken`.** Signature at
   `src/vs/base/node/zip.ts:218` is
   `extract(zipPath, targetPath, options: IExtractOptions = {}, token: CancellationToken)`.
8. **The website workflow has no `latest` aliases today.** `release-docs-bundles.yml` uploads only
   `positron-docs-<version>.zip` and `positron-workbench-docs-<version>.zip` to
   `s3://posit-positron-downloads/positron/<channel>/docs`. Part A creates the alias concept.
9. **`llms.txt` is real and matches the spec's estimate.** `https://positron.posit.co/llms.txt` is
   7310 bytes with 95 absolute `.llms.md` links; `welcome.llms.md` resolves 200.

---

# Part A: the slim bundle (posit-dev/positron-website)

Executed from a `posit-dev/positron-website` checkout. One PR. Independently shippable: it adds new
CDN objects and changes nothing existing.

### Task 1: Bundle build script with content guards

**Files:**
- Create: `scripts/build-llms-bundle.sh`
- Test: manual, driven by a fixture site tree the script itself is pointed at

**Interfaces:**
- Consumes: a rendered Quarto site directory (`_site` or `_site-workbench`)
- Produces: `positron-llms-<version>.zip` / `positron-workbench-llms-<version>.zip` plus a matching
  `.sha256sum`, in the current directory. Task 2 uploads exactly those names.

Usage contract, which Task 2 depends on:

```
scripts/build-llms-bundle.sh <site-dir> <profile> <version>
  <site-dir>  rendered site root, e.g. _site
  <profile>   positron | workbench
  <version>   e.g. 2026.05.0-179
```

- [ ] **Step 1: Write the script**

Create `scripts/build-llms-bundle.sh`:

```bash
#!/usr/bin/env bash
#
# Build the slim LLM-only docs bundle from a rendered Quarto site.
#
# Emits <basename>-<version>.zip and <basename>-<version>.zip.sha256sum in the
# current directory, where <basename> is positron-llms or positron-workbench-llms.
#
# Every guard here is load-bearing: the bundle is consumed by Positron's
# parseManifest(), which rejects anything it does not recognise, so a bad
# bundle must fail this workflow rather than ship.
set -euo pipefail

SITE_DIR="${1:?usage: build-llms-bundle.sh <site-dir> <profile> <version>}"
PROFILE="${2:?usage: build-llms-bundle.sh <site-dir> <profile> <version>}"
VERSION="${3:?usage: build-llms-bundle.sh <site-dir> <profile> <version>}"

# Bump only when a schema-1 reader would misread the bundle. See the design
# spec's "Schema versioning policy" section before changing this.
SCHEMA=1
DOCS_BASE_URL="https://positron.posit.co/"

case "$PROFILE" in
	positron)  BASENAME="positron-llms" ;;
	workbench) BASENAME="positron-workbench-llms" ;;
	*) echo "error: profile must be 'positron' or 'workbench', got '$PROFILE'" >&2; exit 1 ;;
esac

ZIP_NAME="${BASENAME}-${VERSION}.zip"
# Captured before any `cd`: the zip is written here, and step 6 zips from inside
# $STAGE, so a relative path or $OLDPWD would resolve against the wrong dir.
OUT_DIR="$PWD"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [ ! -f "$SITE_DIR/llms.txt" ]; then
	echo "error: $SITE_DIR/llms.txt not found; did the Quarto render run?" >&2
	exit 1
fi

# 1. Copy llms.txt and every *.llms.md, preserving directory structure.
# A tar pipe rather than `cp --parents`: that flag is GNU-only, and this script
# must run on a contributor's macOS checkout as well as the Linux runner.
cp "$SITE_DIR/llms.txt" "$STAGE/llms.txt"

# Guard the empty case before taring: GNU tar refuses to create an empty archive
# and exits non-zero while BSD tar exits 0, so without this the same broken
# render fails cryptically on CI and silently on a Mac. A bundle of llms.txt
# plus bundle.json and no docs is useless either way.
DOC_COUNT="$(cd "$SITE_DIR" && find . -name '*.llms.md' -type f | wc -l | tr -d ' ')"
if [ "$DOC_COUNT" -eq 0 ]; then
	echo "error: no *.llms.md files under $SITE_DIR; the Quarto render produced no LLM docs." >&2
	exit 1
fi

( cd "$SITE_DIR" && find . -name '*.llms.md' -type f -print0 | tar -cf - --null -T - ) \
	| ( cd "$STAGE" && tar -xf - )

# 2. Rewrite llms.txt to bundle-relative paths. This is what schema 1 promises.
# Write-and-move rather than `sed -i`: in-place editing needs no suffix on GNU
# sed and a mandatory one on BSD, so no single `-i` spelling is portable.
sed "s|${DOCS_BASE_URL}||g" "$STAGE/llms.txt" > "$STAGE/llms.txt.rewritten"
mv "$STAGE/llms.txt.rewritten" "$STAGE/llms.txt"

# 3. Guard: no bundled file may still reference the site.
if grep -rl 'positron\.posit\.co' "$STAGE" ; then
	echo "error: bundled files still reference positron.posit.co (listed above)." >&2
	echo "The rewrite assumes only llms.txt carries site links. That assumption broke." >&2
	exit 1
fi

# 4. Guard: every link in llms.txt must now be bundle-relative.
if grep -oE '\]\([^)]+\)' "$STAGE/llms.txt" | grep -E '\((https?:)?//' ; then
	echo "error: llms.txt still contains absolute links (listed above)." >&2
	exit 1
fi

FILE_COUNT="$(find "$STAGE" -type f | wc -l | tr -d ' ')"

# 5. Generate bundle.json, then include it in the count it reports.
cat > "$STAGE/bundle.json" <<JSON
{
  "schema": ${SCHEMA},
  "profile": "${PROFILE}",
  "version": "${VERSION}",
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "docsBaseUrl": "${DOCS_BASE_URL}",
  "fileCount": $((FILE_COUNT + 1))
}
JSON

# 6. Zip, then verify the archive round-trips the guards.
rm -f "$ZIP_NAME"
( cd "$STAGE" && zip -q -r -X "$OUT_DIR/$ZIP_NAME" . )

# Read the entry list once into a variable rather than piping `unzip` into
# `grep -q` per check. Under `set -o pipefail` a `grep -q` that matches early
# can close the pipe before `unzip` finishes writing, and the resulting SIGPIPE
# (141) fails the pipeline even though the archive is fine.
ENTRIES="$(unzip -Z1 "$ZIP_NAME")"

grep -qx 'llms.txt' <<<"$ENTRIES"    || { echo "error: zip missing llms.txt" >&2; exit 1; }
grep -qx 'bundle.json' <<<"$ENTRIES" || { echo "error: zip missing bundle.json" >&2; exit 1; }

# `grep -c` exits 1 on a zero count, which `set -e` would treat as fatal, so
# tolerate it and let the comparison below report the real mismatch.
ZIPPED_COUNT="$(grep -vc '/$' <<<"$ENTRIES" || true)"
DECLARED_COUNT="$((FILE_COUNT + 1))"
if [ "$ZIPPED_COUNT" -ne "$DECLARED_COUNT" ]; then
	echo "error: zip holds $ZIPPED_COUNT files but bundle.json declares $DECLARED_COUNT" >&2
	exit 1
fi

# 7. Digest sidecar. Positron refuses to extract without a matching one.
shasum -a 256 "$ZIP_NAME" > "${ZIP_NAME}.sha256sum"
shasum -a 256 -c "${ZIP_NAME}.sha256sum"

echo "built $ZIP_NAME ($(wc -c < "$ZIP_NAME") bytes, $DECLARED_COUNT files) + sidecar"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/build-llms-bundle.sh
```

- [ ] **Step 3: Build a fixture site and run the script against it, expecting success**

```bash
mkdir -p /tmp/fixture-site/release-notes
printf '# Positron\n\n## Pages\n\n- [Welcome](https://positron.posit.co/welcome.llms.md)\n- [May](https://positron.posit.co/release-notes/release-2026-05.llms.md)\n' > /tmp/fixture-site/llms.txt
printf '# Welcome\n\nHello.\n' > /tmp/fixture-site/welcome.llms.md
printf '# May\n\nNotes.\n' > /tmp/fixture-site/release-notes/release-2026-05.llms.md
printf '<html>ignored</html>' > /tmp/fixture-site/welcome.html

scripts/build-llms-bundle.sh /tmp/fixture-site positron 2026.05.0-179
```

Expected: exits 0, prints `built positron-llms-2026.05.0-179.zip (... bytes, 4 files) + sidecar`.
Four files = `llms.txt` + two `.llms.md` + `bundle.json`. `welcome.html` must NOT be included.

- [ ] **Step 4: Verify the rewrite and the manifest**

```bash
unzip -p positron-llms-2026.05.0-179.zip llms.txt
unzip -p positron-llms-2026.05.0-179.zip bundle.json
unzip -Z1 positron-llms-2026.05.0-179.zip
```

Expected: `llms.txt` links read `(welcome.llms.md)` and `(release-notes/release-2026-05.llms.md)` with
no `https://`. `bundle.json` has `"schema": 1`, `"profile": "positron"`,
`"version": "2026.05.0-179"`, `"fileCount": 4`. The listing contains no `.html`.

- [ ] **Step 5: Verify the leak guard actually fails the build**

```bash
printf '\nSee https://positron.posit.co/troubleshooting.html for more.\n' >> /tmp/fixture-site/welcome.llms.md
scripts/build-llms-bundle.sh /tmp/fixture-site positron 2026.05.0-179 ; echo "exit=$?"
```

Expected: prints the offending path, the "assumption broke" message, and `exit=1`. This is the guard
that stops the assistant silently emitting `positron.posit.co` links out of supposedly local docs, so
confirm it fires before trusting it. Then undo the edit:

```bash
printf '# Welcome\n\nHello.\n' > /tmp/fixture-site/welcome.llms.md
```

- [ ] **Step 6: Verify the empty-docs guard fires**

```bash
mkdir -p /tmp/empty-site
cp /tmp/fixture-site/llms.txt /tmp/empty-site/llms.txt
scripts/build-llms-bundle.sh /tmp/empty-site positron 2026.05.0-179 ; echo "exit=$?"
```

Expected: `error: no *.llms.md files under ...; the Quarto render produced no LLM docs.` and `exit=1`.
This guard exists because GNU tar refuses to create an empty archive while BSD tar accepts one, so
without it the same broken render fails cryptically on CI and silently on a Mac.

- [ ] **Step 7: Verify the workbench profile names its output correctly**

```bash
scripts/build-llms-bundle.sh /tmp/fixture-site workbench 2026.05.0-179
ls positron-workbench-llms-2026.05.0-179.zip positron-workbench-llms-2026.05.0-179.zip.sha256sum
```

Expected: both files exist. These names must match Task 11's `resolveBundleRequest` exactly.

- [ ] **Step 8: Verify the sidecar catches corruption**

```bash
cp positron-llms-2026.05.0-179.zip corrupt.zip
printf 'x' >> corrupt.zip

# `shasum -c` reads the filename out of the sidecar, so point a copy of the
# sidecar at the corrupted file while keeping the original's digest.
sed 's|positron-llms-2026.05.0-179.zip|corrupt.zip|' \
	positron-llms-2026.05.0-179.zip.sha256sum > corrupt.zip.sha256sum

shasum -a 256 -c corrupt.zip.sha256sum ; echo "corrupt=$?"
shasum -a 256 -c positron-llms-2026.05.0-179.zip.sha256sum ; echo "good=$?"
```

Expected: `corrupt.zip: FAILED` and `corrupt=1` for the tampered copy, then `OK` and `good=0` for the
untouched zip. Both halves matter: the clean check alone passes whether or not a digest mismatch is
actually detectable, so it cannot on its own tell you the sidecar is doing any work. The sidecar format
is `<hex>  <filename>`, which is what Task 4's `parseSha256Sidecar` parses.

- [ ] **Step 9: Clean up and commit**

```bash
rm -f positron-llms-2026.05.0-179.zip* positron-workbench-llms-2026.05.0-179.zip* corrupt.zip*
rm -rf /tmp/fixture-site /tmp/empty-site
git add scripts/build-llms-bundle.sh
git commit -m "Add slim LLM docs bundle build script with content guards"
```

---

### Task 2: Publish the slim bundles from the release workflow

**Files:**
- Modify: `.github/workflows/release-docs-bundles.yml`

**Interfaces:**
- Consumes: `scripts/build-llms-bundle.sh` from Task 1
- Produces: eight CDN objects per release under
  `s3://posit-positron-downloads/positron/<channel>/docs/` - a versioned zip and a `latest` alias per
  profile, each with a `.sha256sum`. Part C's default `positronLlmsDocsUrl` points at the CloudFront
  view of that prefix for the `releases` channel.

**Publish order is load-bearing.** Positron treats a missing sidecar as a verification failure and
refuses to extract, so per profile the order is: `<version>.zip.sha256sum`, `<version>.zip`, then
`latest.zip.sha256sum`, then `latest.zip`. The mutable alias moves last so it never points at an
object whose digest has not landed.

- [ ] **Step 1: Add the build step**

In `.github/workflows/release-docs-bundles.yml`, immediately after the existing
`- name: Create docs bundles` step, add:

```yaml
      - name: Create slim LLM docs bundles
        run: |
          scripts/build-llms-bundle.sh _site positron "${{ steps.get-version.outputs.release_version }}"
          scripts/build-llms-bundle.sh _site-workbench workbench "${{ steps.get-version.outputs.release_version }}"
```

The existing step ends with `cd ../_site-workbench`, so this new step starts in the workspace root
only because each `run:` block gets a fresh shell at the default working directory. That is why the
paths here are `_site` and `_site-workbench` rather than `../_site`.

- [ ] **Step 2: Add the upload step**

Immediately after the existing `- name: Upload docs bundles to S3` step, add:

```yaml
      - name: Upload slim LLM bundles to S3
        env:
          VERSION: ${{ steps.get-version.outputs.release_version }}
          CHANNEL: ${{ inputs.release_channel }}
        run: |
          set -euo pipefail
          S3_PREFIX="s3://posit-positron-downloads/positron/${CHANNEL}/docs"

          for BASENAME in positron-llms positron-workbench-llms; do
            ZIP="${BASENAME}-${VERSION}.zip"

            # Sidecar before zip: a zip reachable without its digest is a window
            # in which a cold-cache Positron install gets no local docs.
            aws s3 cp "${ZIP}.sha256sum" "${S3_PREFIX}/${ZIP}.sha256sum" \
              --no-progress --cache-control "public, max-age=31536000, immutable"
            aws s3 cp "${ZIP}" "${S3_PREFIX}/${ZIP}" \
              --no-progress --cache-control "public, max-age=31536000, immutable"
          done

      - name: Move latest aliases
        # Only the releases channel owns the mutable alias every install reads.
        # A staging or dailies run must not repoint it.
        if: ${{ inputs.release_channel == 'releases' }}
        env:
          VERSION: ${{ steps.get-version.outputs.release_version }}
        run: |
          set -euo pipefail
          S3_PREFIX="s3://posit-positron-downloads/positron/releases/docs"

          for BASENAME in positron-llms positron-workbench-llms; do
            ZIP="${BASENAME}-${VERSION}.zip"
            ALIAS="${BASENAME}-latest.zip"

            # Rewrite the sidecar to name the alias, so `shasum -c` against the
            # downloaded alias still matches. Positron only reads the hex digest,
            # but a self-consistent sidecar keeps manual verification honest.
            DIGEST="$(cut -d' ' -f1 < "${ZIP}.sha256sum")"
            printf '%s  %s\n' "$DIGEST" "$ALIAS" > "${ALIAS}.sha256sum"

            # no-cache is what makes Positron's conditional GET meaningful:
            # CloudFront revalidates with the origin, so a 304 genuinely means
            # unchanged rather than "stale edge copy".
            aws s3 cp "${ALIAS}.sha256sum" "${S3_PREFIX}/${ALIAS}.sha256sum" \
              --no-progress --cache-control "no-cache"

            # Source is the versioned zip: there is no local file named ${ALIAS}.
            aws s3 cp "${ZIP}" "${S3_PREFIX}/${ALIAS}" \
              --no-progress --cache-control "no-cache"
          done
```

- [ ] **Step 3: Add the post-upload assertion step**

Immediately after the `Move latest aliases` step, add:

```yaml
      - name: Assert published LLM bundle objects
        env:
          VERSION: ${{ steps.get-version.outputs.release_version }}
          CHANNEL: ${{ inputs.release_channel }}
        run: |
          set -euo pipefail
          S3_BUCKET="posit-positron-downloads"
          # Bucket-relative key prefix, not an s3:// URL: head-object takes
          # --bucket and --key separately.
          KEY_PREFIX="positron/${CHANNEL}/docs"

          # head-object rather than `aws s3 ls`: `ls` on an exact key is a prefix
          # listing, and whether an empty listing exits non-zero depends on the
          # AWS CLI major version (v2 exits 1, v1 exited 0). head-object fails on
          # a missing key regardless, so the assertion does not silently weaken if
          # the runner image's CLI ever changes.
          assert_exists() {
            local key="$1"
            if ! aws s3api head-object --bucket "$S3_BUCKET" --key "$key" > /dev/null; then
              echo "error: expected object $key is not present." >&2
              exit 1
            fi
          }

          check_no_cache() {
            local key="$1"
            local cc
            cc="$(aws s3api head-object --bucket "$S3_BUCKET" --key "$key" \
                    --query 'CacheControl' --output text)"
            if [ "$cc" != "no-cache" ]; then
              echo "error: $key has Cache-Control '$cc', expected 'no-cache'." >&2
              echo "A cached alias makes every conditional GET answer 304 forever." >&2
              exit 1
            fi
          }

          for BASENAME in positron-llms positron-workbench-llms; do
            ZIP="${BASENAME}-${VERSION}.zip"
            # Every uploaded zip must have a reachable sidecar. Positron refuses
            # to extract a zip it cannot verify, so a dropped sidecar ships a
            # bundle that no install will ever use.
            assert_exists "${KEY_PREFIX}/${ZIP}"
            assert_exists "${KEY_PREFIX}/${ZIP}.sha256sum"
          done

          if [ "$CHANNEL" = "releases" ]; then
            for BASENAME in positron-llms positron-workbench-llms; do
              ALIAS="${BASENAME}-latest.zip"
              assert_exists "${KEY_PREFIX}/${ALIAS}"
              assert_exists "${KEY_PREFIX}/${ALIAS}.sha256sum"
              check_no_cache "${KEY_PREFIX}/${ALIAS}"
              check_no_cache "${KEY_PREFIX}/${ALIAS}.sha256sum"
            done
          fi
```

- [ ] **Step 4: Confirm CloudFront invalidation already covers the aliases**

Read the existing `Invalidate CloudFront Cache` step. Its path is
`/positron/${{ inputs.release_channel }}/docs/*`, which already covers the two `latest` keys and
their sidecars. **No change needed.** Note this in the PR description so a reviewer does not look for
a missing invalidation.

- [ ] **Step 5: Lint the workflow**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-docs-bundles.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-docs-bundles.yml
git commit -m "Publish slim LLM docs bundles with digest sidecars and latest aliases"
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --repo posit-dev/positron-website \
  --title "Publish slim LLM-only docs bundles for Positron's AI assistant" \
  --body 'See posit-dev/positron docs/design/2026-07-27-bundle-positron-docs-design.md, Step 1.'
```

Then trigger one `workflow_dispatch` run against the `releases` channel and confirm all eight objects
land. Parts B and C do not block on this - manual validation step 5 in the spec uses a local server.

---

# Part B: the platform module (Positron PR 2a)

Zero wiring, zero registration, nothing instantiated at runtime. The code is unreachable until Part C
lands, so it reviews purely on its own merits. Every task here is Vitest-only: **no build daemons
needed**.

### Task 3: Bundle types, URL resolution, and manifest parsing

**Files:**
- Create: `src/vs/platform/positronDocs/common/positronDocsBundle.ts`
- Test: `src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts`

**Interfaces:**
- Consumes: `formatPositronVersion` from
  `src/vs/platform/extensionManagement/common/positronGalleryTelemetry.ts:61`
- Produces, relied on by Tasks 4-7 and 11-12:
  - `DOCS_BUNDLE_SCHEMA: 1`
  - `type DocsProfile = 'positron' | 'workbench'`
  - `type DocsResolution = 'exact' | 'fallback' | 'latest-by-policy'`
  - `interface IDocsBundleManifest { schema; profile; version; generated; docsBaseUrl; fileCount }`
  - `interface IDocsCacheState { ... }`
  - `interface IDocsBundleRequest { quality; positronVersion; positronBuildNumber; profile; baseUrl }`
  - `interface IResolvedBundle { version; form: 'exact' | 'latest'; zipUrl; sha256Url }`
  - `resolveBundleRequest(request: IDocsBundleRequest): { exact: IResolvedBundle; latest: IResolvedBundle; wantsExact: boolean }`
  - `parseManifest(raw: string): IDocsBundleManifest | undefined`
  - `parseSha256Sidecar(raw: string): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { DocsProfile, parseManifest, parseSha256Sidecar, resolveBundleRequest } from '../../common/positronDocsBundle.js';

const BASE = 'https://cdn.posit.co/positron/releases/docs';

function request(overrides: { quality?: string; profile?: DocsProfile; build?: number } = {}) {
	return {
		quality: 'quality' in overrides ? overrides.quality : 'releases',
		positronVersion: '2026.05.0',
		positronBuildNumber: overrides.build ?? 179,
		profile: overrides.profile ?? ('positron' as DocsProfile),
		baseUrl: BASE,
	};
}

describe('resolveBundleRequest', () => {
	// The three quality values are verified against build/utils.ts, not assumed.
	// A future channel rename must fail here rather than silently change behaviour.
	it.each([
		['releases', true],
		['dailies', false],
		[undefined, false],
	])('quality %s => wantsExact %s', (quality, wantsExact) => {
		expect(resolveBundleRequest(request({ quality })).wantsExact).toBe(wantsExact);
	});

	it('builds exact and latest URLs plus sidecars for the positron profile', () => {
		const { exact, latest } = resolveBundleRequest(request());
		expect({ exact, latest }).toMatchInlineSnapshot();
	});

	it('uses the workbench basename for the workbench profile', () => {
		expect(resolveBundleRequest(request({ profile: 'workbench' })).exact.zipUrl)
			.toBe(`${BASE}/positron-workbench-llms-2026.05.0-179.zip`);
	});

	it('omits the -0 suffix for dev builds', () => {
		expect(resolveBundleRequest(request({ build: 0 })).exact.version).toBe('2026.05.0');
	});

	it('tolerates a trailing slash on the base URL', () => {
		expect(resolveBundleRequest({ ...request(), baseUrl: `${BASE}/` }).latest.zipUrl)
			.toBe(`${BASE}/positron-llms-latest.zip`);
	});
});

describe('parseManifest', () => {
	const valid = JSON.stringify({
		schema: 1, profile: 'positron', version: '2026.05.0-179',
		generated: '2026-07-24T18:02:11Z', docsBaseUrl: 'https://positron.posit.co/', fileCount: 90,
	});

	it('accepts a well-formed schema 1 manifest', () => {
		expect(parseManifest(valid)).toMatchInlineSnapshot();
	});

	it.each([
		['schema 2', JSON.stringify({ ...JSON.parse(valid), schema: 2 })],
		['malformed JSON', '{ not json'],
		['missing version', JSON.stringify({ schema: 1, profile: 'positron', fileCount: 90, docsBaseUrl: 'x', generated: 'y' })],
		['non-numeric fileCount', JSON.stringify({ ...JSON.parse(valid), fileCount: 'ninety' })],
	])('rejects %s', (_label, raw) => {
		expect(parseManifest(raw)).toBeUndefined();
	});
});

describe('parseSha256Sidecar', () => {
	const digest = 'a'.repeat(64);

	it.each([
		['shasum format', `${digest}  positron-llms-latest.zip\n`],
		['bare hex', `${digest}\n`],
		['uppercase hex', `${digest.toUpperCase()}  x.zip`],
	])('accepts %s', (_label, raw) => {
		expect(parseSha256Sidecar(raw)).toBe(digest);
	});

	it.each([
		['empty', ''],
		['too short', 'abc123  x.zip'],
		['non-hex', `${'z'.repeat(64)}  x.zip`],
		['an HTML error page', '<!DOCTYPE html><html><body>404</body></html>'],
	])('rejects %s', (_label, raw) => {
		expect(parseSha256Sidecar(raw)).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts`
Expected: FAIL, cannot resolve `../../common/positronDocsBundle.js`.

- [ ] **Step 3: Write the implementation**

Create `src/vs/platform/positronDocs/common/positronDocsBundle.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatPositronVersion } from '../../extensionManagement/common/positronGalleryTelemetry.js';

/**
 * The only bundle layout this build understands. Bumped by the website
 * pipeline only when a reader written against the old layout would get a
 * wrong answer. Schema 1 is defined as including "llms.txt uses
 * bundle-relative paths".
 */
export const DOCS_BUNDLE_SCHEMA = 1;

/** Name of the persisted state file inside the cache root. */
export const DOCS_STATE_FILENAME = 'state.json';

/** Files a valid extracted bundle must contain. */
export const DOCS_MANIFEST_FILENAME = 'bundle.json';
export const DOCS_INDEX_FILENAME = 'llms.txt';

/** Refuse anything larger. The real bundle is about 150KB. */
export const DOCS_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export type DocsProfile = 'positron' | 'workbench';

/**
 * How the cached bundle relates to the running build.
 * - `exact`: bundle version equals app version. Terminal; no further network.
 * - `fallback`: exact was not published (yet). Re-attempts exact every launch.
 * - `latest-by-policy`: dailies and dev builds, where latest is the target.
 */
export type DocsResolution = 'exact' | 'fallback' | 'latest-by-policy';

/** The shape of bundle.json, as produced by the website pipeline. */
export interface IDocsBundleManifest {
	readonly schema: number;
	readonly profile: string;
	readonly version: string;
	readonly generated: string;
	readonly docsBaseUrl: string;
	readonly fileCount: number;
}

/** Persisted cache state. Written atomically; never partially trusted. */
export interface IDocsCacheState {
	readonly schema: number;
	/** Version of the bundle actually on disk; also its directory name. */
	readonly version: string;
	/** Version the app asked for, which may differ while in `fallback`. */
	readonly requestedVersion: string;
	readonly resolution: DocsResolution;
	readonly profile: string;
	/**
	 * Digest verified before extraction. Diagnostic only: recorded once and
	 * never recomputed, since the zip is deleted after extracting.
	 */
	readonly sha256: string;
	readonly etag?: string;
	readonly sourceUrl: string;
	readonly fetchedAt: number;
	readonly lastAttemptAt: number;
	readonly lastFailureAt?: number;
	readonly lastError?: string;
}

export interface IDocsBundleRequest {
	/** `initData.quality`: 'releases', 'dailies', or undefined in dev builds. */
	readonly quality: string | undefined;
	readonly positronVersion: string;
	readonly positronBuildNumber: number;
	readonly profile: DocsProfile;
	readonly baseUrl: string;
}

export interface IResolvedBundle {
	/** `<version>` for the exact form, the literal 'latest' for the alias. */
	readonly version: string;
	readonly form: 'exact' | 'latest';
	readonly zipUrl: string;
	readonly sha256Url: string;
}

export interface IResolvedBundleRequest {
	readonly exact: IResolvedBundle;
	readonly latest: IResolvedBundle;
	/**
	 * True for release builds, which target their exact version and fall back
	 * to latest only until it publishes. False for dailies and dev builds,
	 * where latest is the intended target.
	 */
	readonly wantsExact: boolean;
}

function bundleBaseName(profile: DocsProfile): string {
	return profile === 'workbench' ? 'positron-workbench-llms' : 'positron-llms';
}

function bundleUrls(baseUrl: string, profile: DocsProfile, version: string, form: 'exact' | 'latest'): IResolvedBundle {
	const root = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
	const zipUrl = `${root}/${bundleBaseName(profile)}-${version}.zip`;
	return { version, form, zipUrl, sha256Url: `${zipUrl}.sha256sum` };
}

/**
 * Work out which bundle URLs this build should ask for.
 *
 * Release builds target their exact version so a shipped build reads the docs
 * it shipped with; everything else targets the mutable `latest` alias. Dev
 * builds landing on `latest` is deliberate - it makes the feature exercisable
 * locally and in PRs without waiting on a release.
 */
export function resolveBundleRequest(request: IDocsBundleRequest): IResolvedBundleRequest {
	const version = formatPositronVersion(request.positronVersion, request.positronBuildNumber);
	return {
		exact: bundleUrls(request.baseUrl, request.profile, version, 'exact'),
		latest: bundleUrls(request.baseUrl, request.profile, 'latest', 'latest'),
		wantsExact: request.quality === 'releases',
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/**
 * Parse bundle.json, rejecting anything this build cannot read.
 *
 * Rejecting is deliberate over guessing: dev and daily builds fetch the mutable
 * `latest` alias, so "an app from three months ago is handed a bundle from
 * today's pipeline" is a normal runtime state. A misparse surfaces later as
 * wrong docs content; a rejection surfaces immediately as web fallback.
 */
export function parseManifest(raw: string): IDocsBundleManifest | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return undefined;
	}
	const candidate = parsed as Partial<IDocsBundleManifest>;
	if (candidate.schema !== DOCS_BUNDLE_SCHEMA) {
		return undefined;
	}
	if (!isNonEmptyString(candidate.profile) || !isNonEmptyString(candidate.version)
		|| !isNonEmptyString(candidate.generated) || !isNonEmptyString(candidate.docsBaseUrl)) {
		return undefined;
	}
	if (typeof candidate.fileCount !== 'number' || !Number.isInteger(candidate.fileCount) || candidate.fileCount <= 0) {
		return undefined;
	}
	return {
		schema: candidate.schema,
		profile: candidate.profile,
		version: candidate.version,
		generated: candidate.generated,
		docsBaseUrl: candidate.docsBaseUrl,
		fileCount: candidate.fileCount,
	};
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Read the hex digest out of a `.sha256sum` sidecar.
 *
 * Accepts both `shasum -a 256` output (`<hex>  <name>`) and a bare digest.
 * Returns undefined for anything else, including an HTML error page served in
 * place of a missing object - which the caller must treat as a hard failure.
 */
export function parseSha256Sidecar(raw: string): string | undefined {
	const first = raw.trim().split(/\s+/)[0]?.toLowerCase();
	return first && SHA256_HEX.test(first) ? first : undefined;
}
```

- [ ] **Step 4: Fill the inline snapshots and run the tests**

```bash
npx vitest run --update src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts
```

Then **read the two filled snapshots** and confirm by eye:
- `exact.zipUrl` is `https://cdn.posit.co/positron/releases/docs/positron-llms-2026.05.0-179.zip`
- `exact.sha256Url` is that plus `.sha256sum`
- `latest.zipUrl` is `.../positron-llms-latest.zip`
- the manifest snapshot has all six fields with `schema: 1`

Then re-run without `--update`:

```bash
npx vitest run src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Type-check the test file**

```bash
npm run test:positron:check-ts 2>&1 | grep 'positronDocsBundle.vitest.ts'
```

Expected: no output (no errors).

- [ ] **Step 6: Lint and commit**

```bash
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/positronDocsBundle.ts src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsBundle.ts src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts
git add src/vs/platform/positronDocs/common/positronDocsBundle.ts src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts
git commit -m "Add docs bundle types, URL resolution, and manifest parsing"
```

---

### Task 4: Ports, in-memory fakes, and the validation module

**Files:**
- Create: `src/vs/platform/positronDocs/common/positronDocsPorts.ts`
- Create: `src/vs/platform/positronDocs/common/positronDocsValidate.ts`
- Create: `src/vs/platform/positronDocs/test/common/fakes.ts`
- Test: `src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts`

**Interfaces:**
- Consumes: everything Task 3 produced
- Produces, relied on by Tasks 5-7 and 11:
  - `IDocsHttpClient` - `get(url, options?)`, `head(url)`
  - `IDocsFileStore` - `exists`, `readFile`, `writeFile`, `mkdir`, `rename`, `delete`, `readdir`,
    `mtime`, `sha256`
  - `IDocsArchive` - `entryNames(zipPath)`, `extract(zipPath, targetPath)`
  - `IDocsLogger` - `info(message)`, `warn(message)`
  - `ILocalDocs` - the resolved result the API returns
  - `joinDocsPath(...segments)`
  - `guardEntryNames(names)`, `validateExtractedBundle(files, dir, manifestFileCount?)`
  - Test fakes: `FakeHttpClient`, `FakeFileStore`, `FakeArchive`, `recordingLogger()`

Three narrow ports rather than one wide interface, so each fake is three to six methods. `sha256`
sits on the file store rather than in its own port because hashing needs node `crypto`, which
`common` cannot import; treating it as a file operation keeps the port count down without leaking a
node dependency into the seam.

- [ ] **Step 1: Write the ports file**

Create `src/vs/platform/positronDocs/common/positronDocsPorts.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ports for the docs cache. Deliberately three narrow interfaces rather than
 * one wide one, so each test fake stays small and the seam can be re-hosted in
 * a node service later without a rewrite.
 *
 * Paths are plain strings joined with forward slashes. Node's fs accepts
 * forward slashes on Windows, so no platform-specific joining is needed here
 * and `common` stays free of node imports.
 */

export interface IDocsHttpResponse {
	readonly status: number;
	readonly etag?: string;
	/** Absent on 304, on any error status, and on HEAD. */
	readonly body?: Uint8Array;
}

export interface IDocsHttpGetOptions {
	/** Send as `If-None-Match`, so an unchanged alias answers 304. */
	readonly etag?: string;
	/** Abort and reject once the response exceeds this many bytes. */
	readonly maxBytes?: number;
}

export interface IDocsHttpClient {
	get(url: string, options?: IDocsHttpGetOptions): Promise<IDocsHttpResponse>;
	head(url: string): Promise<IDocsHttpResponse>;
}

export interface IDocsFileStore {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string>;
	writeFile(path: string, data: string | Uint8Array): Promise<void>;
	/** Recursive; succeeds if the directory already exists. */
	mkdir(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	/** Recursive; succeeds if the path does not exist. */
	delete(path: string): Promise<void>;
	/** Immediate children, names only. Empty array if the path is missing. */
	readdir(path: string): Promise<string[]>;
	/** Epoch millis, or undefined if the path is missing. Used by the prune guard. */
	mtime(path: string): Promise<number | undefined>;
	/** Lowercase hex digest of the file's bytes. */
	sha256(path: string): Promise<string>;
}

export interface IDocsArchive {
	/** Entry paths as recorded in the archive, before any extraction. */
	entryNames(zipPath: string): Promise<string[]>;
	extract(zipPath: string, targetPath: string): Promise<void>;
}

/**
 * Narrow logger so the seam does not depend on ILogService. Nothing here is
 * user-actionable, so there is deliberately no error level.
 */
export interface IDocsLogger {
	info(message: string): void;
	warn(message: string): void;
}

/** What `positron.docs.getLocalDocs()` resolves to. */
export interface ILocalDocs {
	readonly path: string;
	readonly schema: number;
	readonly version: string;
	readonly profile: string;
	readonly docsBaseUrl: string;
	readonly isExactMatch: boolean;
}

/** Join path segments with forward slashes, collapsing duplicates. */
export function joinDocsPath(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.map((segment, index) => index === 0 ? segment.replace(/\/+$/, '') : segment.replace(/^\/+|\/+$/g, ''))
		.join('/');
}
```

- [ ] **Step 2: Write the failing validation test**

Create `src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { guardEntryNames, validateExtractedBundle } from '../../common/positronDocsValidate.js';
import { FakeFileStore } from './fakes.js';

describe('guardEntryNames', () => {
	it('accepts ordinary nested entries', () => {
		expect(guardEntryNames(['llms.txt', 'bundle.json', 'release-notes/release-2026-05.llms.md'])).toBeUndefined();
	});

	// The archive arrives over the network, so we assert these ourselves rather
	// than trusting base/node/zip.ts to have done it.
	it.each([
		['an absolute posix path', '/etc/passwd'],
		['a windows drive path', 'C:\\Windows\\system32'],
		['a parent traversal', '../../outside.md'],
		['a nested parent traversal', 'docs/../../outside.md'],
		['a null byte', 'llms\u0000.txt'],
		['a UNC path', '\\\\server\\share\\x'],
	])('rejects %s', (_label, entry) => {
		expect(guardEntryNames(['llms.txt', entry])).toContain(entry);
	});
});

describe('validateExtractedBundle', () => {
	const manifest = JSON.stringify({
		schema: 1, profile: 'positron', version: '2026.05.0-179',
		generated: '2026-07-24T18:02:11Z', docsBaseUrl: 'https://positron.posit.co/', fileCount: 3,
	});

	function store(entries: Record<string, string>) {
		return new FakeFileStore(entries);
	}

	it('accepts a well-formed extracted bundle', async () => {
		const files = store({
			'/c/2026.05.0-179/bundle.json': manifest,
			'/c/2026.05.0-179/llms.txt': '# Positron\n',
			'/c/2026.05.0-179/welcome.llms.md': '# Welcome\n',
		});
		const result = await validateExtractedBundle(files, '/c/2026.05.0-179');
		expect(result.ok && result.manifest.version).toBe('2026.05.0-179');
	});

	it('rejects a missing bundle.json', async () => {
		const files = store({ '/c/x/llms.txt': '# Positron\n' });
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'missing-manifest' });
	});

	it('rejects a missing llms.txt', async () => {
		const files = store({ '/c/x/bundle.json': manifest });
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'missing-index' });
	});

	it('rejects schema 2', async () => {
		const files = store({
			'/c/x/bundle.json': JSON.stringify({ ...JSON.parse(manifest), schema: 2 }),
			'/c/x/llms.txt': '# Positron\n',
		});
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'bad-manifest' });
	});

	it('rejects a fileCount that does not match what was extracted', async () => {
		const files = store({
			'/c/x/bundle.json': JSON.stringify({ ...JSON.parse(manifest), fileCount: 99 }),
			'/c/x/llms.txt': '# Positron\n',
		});
		expect(await validateExtractedBundle(files, '/c/x')).toMatchObject({ ok: false, reason: 'file-count-mismatch' });
	});
});
```

- [ ] **Step 3: Write the fakes**

Create `src/vs/platform/positronDocs/test/common/fakes.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsHttpGetOptions, IDocsHttpResponse, IDocsLogger } from '../../common/positronDocsPorts.js';

/**
 * Deterministic stand-in for a real sha256. Only equality matters in these
 * tests, and exporting it lets a test compute the digest a sidecar should
 * carry without duplicating the algorithm.
 */
export function fakeDigest(contents: string): string {
	let hash = 0;
	for (let i = 0; i < contents.length; i++) {
		hash = (Math.imul(hash, 31) + contents.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(64, '0');
}

/**
 * In-memory file store. Directories are implicit: a path is a directory if any
 * stored key starts with it plus a slash.
 */
export class FakeFileStore implements IDocsFileStore {
	readonly files = new Map<string, string>();
	readonly mtimes = new Map<string, number>();
	/** Set to a path prefix to make every write under it fail, simulating a full disk. */
	failWritesUnder: string | undefined;
	/** Digest overrides, keyed by path. Defaults to a hash of the contents. */
	readonly digests = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [path, contents] of Object.entries(initial)) {
			this.files.set(path, contents);
			this.mtimes.set(path, 0);
		}
	}

	private isDir(path: string): boolean {
		const prefix = `${path}/`;
		for (const key of this.files.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return this.mtimes.has(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.isDir(path);
	}

	async readFile(path: string): Promise<string> {
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return contents;
	}

	async writeFile(path: string, data: string | Uint8Array): Promise<void> {
		if (this.failWritesUnder && path.startsWith(this.failWritesUnder)) {
			throw new Error(`ENOSPC: no space left on device, write '${path}'`);
		}
		// Decode rather than record a length: the cache writes downloaded zip
		// bytes through this method, and FakeArchive must be able to read them
		// back as its fake-zip payload string.
		this.files.set(path, typeof data === 'string' ? data : new TextDecoder().decode(data));
		this.mtimes.set(path, 0);
	}

	async mkdir(path: string): Promise<void> {
		this.mtimes.set(path, this.mtimes.get(path) ?? 0);
	}

	async rename(from: string, to: string): Promise<void> {
		for (const [key, value] of [...this.files]) {
			if (key === from || key.startsWith(`${from}/`)) {
				this.files.delete(key);
				this.files.set(to + key.slice(from.length), value);
			}
		}
		for (const [key, value] of [...this.mtimes]) {
			if (key === from || key.startsWith(`${from}/`)) {
				this.mtimes.delete(key);
				this.mtimes.set(to + key.slice(from.length), value);
			}
		}
	}

	async delete(path: string): Promise<void> {
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.files.delete(key);
			}
		}
		for (const key of [...this.mtimes.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.mtimes.delete(key);
			}
		}
	}

	async readdir(path: string): Promise<string[]> {
		const prefix = `${path}/`;
		const names = new Set<string>();
		for (const key of [...this.files.keys(), ...this.mtimes.keys()]) {
			if (key.startsWith(prefix)) {
				names.add(key.slice(prefix.length).split('/')[0]);
			}
		}
		return [...names];
	}

	async mtime(path: string): Promise<number | undefined> {
		return this.mtimes.get(path);
	}

	async sha256(path: string): Promise<string> {
		const override = this.digests.get(path);
		if (override !== undefined) {
			return override;
		}
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return fakeDigest(contents);
	}

	/** Every file path currently stored under `dir`, recursively. */
	listUnder(dir: string): string[] {
		return [...this.files.keys()].filter(key => key.startsWith(`${dir}/`)).sort();
	}
}

export interface IFakeHttpRoute {
	readonly status: number;
	readonly body?: string;
	readonly etag?: string;
	/** Throw instead of responding, simulating DNS or connection failure. */
	readonly throws?: string;
	/** Response size in bytes for the maxBytes check; defaults to body length. */
	readonly byteLength?: number;
}

export class FakeHttpClient implements IDocsHttpClient {
	readonly getCalls: string[] = [];
	readonly headCalls: string[] = [];
	private readonly routes = new Map<string, IFakeHttpRoute>();

	route(url: string, route: IFakeHttpRoute): this {
		this.routes.set(url, route);
		return this;
	}

	async get(url: string, options?: IDocsHttpGetOptions): Promise<IDocsHttpResponse> {
		this.getCalls.push(url);
		const route = this.routes.get(url) ?? { status: 404 };
		if (route.throws) {
			throw new Error(route.throws);
		}
		const size = route.byteLength ?? route.body?.length ?? 0;
		if (options?.maxBytes !== undefined && size > options.maxBytes) {
			throw new Error(`docs bundle exceeds ${options.maxBytes} bytes`);
		}
		if (options?.etag !== undefined && route.etag !== undefined && options.etag === route.etag) {
			return { status: 304, etag: route.etag };
		}
		if (route.status !== 200) {
			return { status: route.status };
		}
		return { status: 200, etag: route.etag, body: new TextEncoder().encode(route.body ?? '') };
	}

	async head(url: string): Promise<IDocsHttpResponse> {
		this.headCalls.push(url);
		const route = this.routes.get(url) ?? { status: 404 };
		if (route.throws) {
			throw new Error(route.throws);
		}
		return { status: route.status, etag: route.etag };
	}
}

/**
 * Fake archive. A "zip" is the string the file store holds at its path, of the
 * form `zip:<entry>=<contents>;<entry>=<contents>`.
 */
export class FakeArchive implements IDocsArchive {
	constructor(private readonly files: FakeFileStore) { }

	private parse(zipPath: string): Array<[string, string]> {
		const raw = this.files.files.get(zipPath);
		if (raw === undefined || !raw.startsWith('zip:')) {
			throw new Error(`end of central directory record signature not found: ${zipPath}`);
		}
		return raw.slice(4).split(';').filter(part => part.length > 0)
			.map(part => {
				const index = part.indexOf('=');
				return [part.slice(0, index), part.slice(index + 1)] as [string, string];
			});
	}

	async entryNames(zipPath: string): Promise<string[]> {
		return this.parse(zipPath).map(([name]) => name);
	}

	async extract(zipPath: string, targetPath: string): Promise<void> {
		for (const [name, contents] of this.parse(zipPath)) {
			await this.files.writeFile(`${targetPath}/${name}`, contents);
		}
	}
}

/** Build the fake-zip payload string for a set of entries. */
export function fakeZip(entries: Record<string, string>): string {
	return `zip:${Object.entries(entries).map(([name, contents]) => `${name}=${contents}`).join(';')}`;
}

export function recordingLogger(): IDocsLogger & { readonly infos: string[]; readonly warns: string[] } {
	const infos: string[] = [];
	const warns: string[] = [];
	return { infos, warns, info: (m: string) => { infos.push(m); }, warn: (m: string) => { warns.push(m); } };
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts`
Expected: FAIL, cannot resolve `../../common/positronDocsValidate.js`.

- [ ] **Step 5: Write the validation module**

Create `src/vs/platform/positronDocs/common/positronDocsValidate.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOCS_INDEX_FILENAME, DOCS_MANIFEST_FILENAME, IDocsBundleManifest, parseManifest } from './positronDocsBundle.js';
import { IDocsFileStore, joinDocsPath } from './positronDocsPorts.js';

export type DocsValidationFailure =
	| 'missing-manifest'
	| 'missing-index'
	| 'bad-manifest'
	| 'file-count-mismatch';

export type DocsValidationResult =
	| { readonly ok: true; readonly manifest: IDocsBundleManifest }
	| { readonly ok: false; readonly reason: DocsValidationFailure };

/**
 * Reject archive entries that could write outside the extraction target.
 *
 * base/node/zip.ts does some of this, but the archive arrives over the network,
 * so we assert it ourselves rather than trusting it. Returns the first
 * offending entry, or undefined when every entry is safe.
 */
export function guardEntryNames(names: readonly string[]): string | undefined {
	for (const name of names) {
		if (name.includes('\u0000')) {
			return name;
		}
		// Normalise Windows separators before reasoning about segments.
		const normalized = name.replace(/\\/g, '/');
		if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
			return name;
		}
		let depth = 0;
		for (const segment of normalized.split('/')) {
			if (segment === '' || segment === '.') {
				continue;
			}
			depth += segment === '..' ? -1 : 1;
			if (depth < 0) {
				return name;
			}
		}
	}
	return undefined;
}

/**
 * Check an extracted bundle before it is swapped into place.
 *
 * Deliberately structural and cheap: bundle.json parses at a schema we
 * understand, llms.txt is present, and the extracted file count matches what
 * the manifest declared. A corrupted byte inside a Markdown page degrades one
 * assistant answer rather than compromising anything, so byte-level integrity
 * is the digest's job at download time, not this function's.
 */
export async function validateExtractedBundle(files: IDocsFileStore, dir: string): Promise<DocsValidationResult> {
	const manifestPath = joinDocsPath(dir, DOCS_MANIFEST_FILENAME);
	if (!await files.exists(manifestPath)) {
		return { ok: false, reason: 'missing-manifest' };
	}
	if (!await files.exists(joinDocsPath(dir, DOCS_INDEX_FILENAME))) {
		return { ok: false, reason: 'missing-index' };
	}

	const manifest = parseManifest(await files.readFile(manifestPath));
	if (!manifest) {
		return { ok: false, reason: 'bad-manifest' };
	}

	const actual = await countFiles(files, dir);
	if (actual !== manifest.fileCount) {
		return { ok: false, reason: 'file-count-mismatch' };
	}
	return { ok: true, manifest };
}

async function countFiles(files: IDocsFileStore, dir: string): Promise<number> {
	let count = 0;
	for (const name of await files.readdir(dir)) {
		const child = joinDocsPath(dir, name);
		// A path that reads as a file is one; anything else recurses.
		const children = await files.readdir(child);
		if (children.length === 0) {
			count += 1;
		} else {
			count += await countFiles(files, child);
		}
	}
	return count;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts`
Expected: PASS, all cases including all six `guardEntryNames` rejections.

- [ ] **Step 7: Type-check, lint, and commit**

```bash
npm run test:positron:check-ts 2>&1 | grep -E 'positronDocs(Validate|Ports)|fakes'
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/positronDocsPorts.ts src/vs/platform/positronDocs/common/positronDocsValidate.ts src/vs/platform/positronDocs/test/common/fakes.ts src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsPorts.ts src/vs/platform/positronDocs/common/positronDocsValidate.ts src/vs/platform/positronDocs/test/common/fakes.ts src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts
git add src/vs/platform/positronDocs/common/positronDocsPorts.ts src/vs/platform/positronDocs/common/positronDocsValidate.ts src/vs/platform/positronDocs/test/common/fakes.ts src/vs/platform/positronDocs/test/common/positronDocsValidate.vitest.ts
git commit -m "Add docs cache ports, test fakes, and extraction validation"
```

Expected from the grep: no output.

---

### Task 5: The cache orchestrator - install path and download rejections

**Files:**
- Create: `src/vs/platform/positronDocs/common/positronDocsCache.ts`
- Test: `src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`

**Interfaces:**
- Consumes: everything Tasks 3 and 4 produced
- Produces, relied on by Tasks 6, 7 and 11:
  - `interface IPositronDocsCacheOptions { rootPath; http; files; archive; logger; now; newId }`
  - `class PositronDocsCache { constructor(options); ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> }`

This task covers: cold-cache download and install, a warm exact cache served with zero network, and
every rejection reachable inside the download pipeline. Task 6 adds resolution and convergence; Task 7
adds concurrency, pruning, and throttling.

- [ ] **Step 1: Write the failing test**

Create `src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { DocsProfile, IDocsBundleRequest } from '../../common/positronDocsBundle.js';
import { PositronDocsCache } from '../../common/positronDocsCache.js';
import { fakeDigest, fakeZip, FakeArchive, FakeFileStore, FakeHttpClient, recordingLogger } from './fakes.js';

const ROOT = '/userdata/User/positron-docs';
const BASE = 'https://cdn.posit.co/positron/releases/docs';
const EXACT_ZIP = `${BASE}/positron-llms-2026.05.0-179.zip`;
const LATEST_ZIP = `${BASE}/positron-llms-latest.zip`;

/** A fake-zip payload whose manifest declares the three files it contains. */
function payload(version: string): string {
	return fakeZip({
		'bundle.json': JSON.stringify({
			schema: 1, profile: 'positron', version,
			generated: '2026-07-24T18:02:11Z',
			docsBaseUrl: 'https://positron.posit.co/', fileCount: 3,
		}),
		'llms.txt': '# Positron\n\n- [Welcome](welcome.llms.md)\n',
		'welcome.llms.md': '# Welcome\n',
	});
}

function request(overrides: Partial<IDocsBundleRequest> = {}): IDocsBundleRequest {
	return {
		quality: 'releases',
		positronVersion: '2026.05.0',
		positronBuildNumber: 179,
		profile: 'positron' as DocsProfile,
		baseUrl: BASE,
		...overrides,
	};
}

function setup() {
	const files = new FakeFileStore();
	const http = new FakeHttpClient();
	const archive = new FakeArchive(files);
	const logger = recordingLogger();
	let clock = 1_000_000;
	let ids = 0;
	const cache = new PositronDocsCache({
		rootPath: ROOT, http, files, archive, logger,
		now: () => clock,
		newId: () => `id${++ids}`,
	});
	return {
		cache, files, http, archive, logger,
		advance: (ms: number) => { clock += ms; },
		/** Serve `zipUrl` with a matching, correctly-formatted sidecar. */
		publish: (zipUrl: string, body: string, etag?: string) => {
			http.route(zipUrl, { status: 200, body, etag });
			http.route(`${zipUrl}.sha256sum`, { status: 200, body: `${fakeDigest(body)}  bundle.zip\n` });
		},
	};
}

describe('PositronDocsCache: cold cache install', () => {
	it('downloads, verifies, extracts, and swaps in a release build bundle', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const docs = await ctx.cache.ensure(request());

		expect(docs).toMatchInlineSnapshot();
	});

	it('records state naming the installed version', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		const state = JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`));
		expect({
			version: state.version, requestedVersion: state.requestedVersion,
			resolution: state.resolution, profile: state.profile, sourceUrl: state.sourceUrl,
		}).toMatchInlineSnapshot();
	});

	it('leaves no temp or staging entries behind', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		expect(ctx.files.listUnder(ROOT).filter(p => p.includes('/.'))).toEqual([]);
	});

	it('fetches the latest alias for a dailies build', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));

		expect(await ctx.cache.ensure(request({ quality: 'dailies' }))).toBeDefined();
		expect(ctx.http.getCalls).toContain(LATEST_ZIP);
		expect(ctx.http.getCalls).not.toContain(EXACT_ZIP);
	});
});

describe('PositronDocsCache: warm exact cache', () => {
	it('serves the cache without touching the network', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());
		const callsAfterInstall = ctx.http.getCalls.length;

		const docs = await ctx.cache.ensure(request());

		expect(docs?.isExactMatch).toBe(true);
		// Release builds are network-free once exactly matched. This is the
		// whole point of version-stamping the cache directory.
		expect(ctx.http.getCalls.length).toBe(callsAfterInstall);
		expect(ctx.http.headCalls).toEqual([]);
	});
});

describe('PositronDocsCache: download rejections on a cold cache', () => {
	// Each of these must leave no version directory behind and return
	// undefined, so the assistant falls back to the web exactly as it does
	// today. Task 6 asserts the same failures against a warm cache.
	async function expectRejected(configure: (ctx: ReturnType<typeof setup>) => void) {
		const ctx = setup();
		configure(ctx);
		const docs = await ctx.cache.ensure(request());
		expect(docs).toBeUndefined();
		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179`)).toBe(false);
		expect(ctx.files.listUnder(ROOT).filter(p => p.includes('/.tmp-') || p.includes('/.staging-'))).toEqual([]);
		return ctx;
	}

	it('rejects when the digest sidecar 404s', async () => {
		const ctx = await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 404 });
		});
		expect(ctx.logger.warns.join('\n')).toContain('digest sidecar');
	});

	it('rejects when the sidecar is unparseable', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: '<!DOCTYPE html><html>404</html>' });
		});
	});

	it('rejects when the digest does not match the zip', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'b'.repeat(64)}  bundle.zip` });
		});
	});

	it('rejects a corrupt archive', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, 'not-a-zip-at-all');
		});
	});

	it('rejects an archive entry that escapes the target', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({ 'llms.txt': 'x', '../../evil.sh': 'rm -rf /' }));
		});
	});

	it('rejects a bundle whose schema is not 1', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 2, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 2 }),
				'llms.txt': '# Positron\n',
			}));
		});
	});

	it('rejects a bundle whose fileCount does not match', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 1, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 99 }),
				'llms.txt': '# Positron\n',
			}));
		});
	});

	it('aborts a download that exceeds the 5MB cap', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179'), byteLength: 6 * 1024 * 1024 });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'c'.repeat(64)}  x` });
		});
	});

	it('returns undefined on a network failure', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 0, throws: 'getaddrinfo ENOTFOUND cdn.posit.co' });
		});
	});

	it('returns undefined on a 5xx', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 503 });
		});
	});

	it('returns undefined on a disk write error', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, payload('2026.05.0-179'));
			c.files.failWritesUnder = ROOT;
		});
	});

	it('never notifies: nothing is logged at a level above warn', async () => {
		const ctx = await expectRejected(c => { c.http.route(EXACT_ZIP, { status: 503 }); });
		// The logger port has no error level on purpose - a docs download
		// failing is not worth interrupting anyone over.
		expect(Object.keys(ctx.logger)).not.toContain('error');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`
Expected: FAIL, cannot resolve `../../common/positronDocsCache.js`.

- [ ] **Step 3: Write the implementation**

Create `src/vs/platform/positronDocs/common/positronDocsCache.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	DOCS_BUNDLE_SCHEMA, DOCS_MAX_DOWNLOAD_BYTES, DOCS_STATE_FILENAME, DocsResolution,
	IDocsBundleManifest, IDocsBundleRequest, IDocsCacheState, IResolvedBundle,
	parseSha256Sidecar, resolveBundleRequest,
} from './positronDocsBundle.js';
import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsLogger, ILocalDocs, joinDocsPath } from './positronDocsPorts.js';
import { guardEntryNames, validateExtractedBundle } from './positronDocsValidate.js';

const LOG_PREFIX = '[positron-docs]';

export interface IPositronDocsCacheOptions {
	/** Cache root, e.g. `<userdata>/User/positron-docs`. */
	readonly rootPath: string;
	readonly http: IDocsHttpClient;
	readonly files: IDocsFileStore;
	readonly archive: IDocsArchive;
	readonly logger: IDocsLogger;
	/** Injected so tests control time without faking timers. */
	readonly now: () => number;
	/** Injected so temp and staging names are deterministic in tests. */
	readonly newId: () => string;
}

/** Outcome of one download attempt. */
type InstallOutcome =
	| { readonly kind: 'installed'; readonly docs: ILocalDocs; readonly manifest: IDocsBundleManifest; readonly digest: string; readonly etag?: string }
	| { readonly kind: 'not-modified' }
	| { readonly kind: 'not-found' }
	/** Verification or validation refused the payload. Never throttled. */
	| { readonly kind: 'rejected'; readonly reason: string }
	/** Network, 5xx, or disk. Throttled across sessions (Task 7). */
	| { readonly kind: 'failed'; readonly reason: string };

function toLocalDocs(path: string, manifest: IDocsBundleManifest, isExactMatch: boolean): ILocalDocs {
	return {
		path,
		schema: manifest.schema,
		version: manifest.version,
		profile: manifest.profile,
		docsBaseUrl: manifest.docsBaseUrl,
		isExactMatch,
	};
}

/**
 * Downloads, verifies, caches, and serves the slim docs bundle.
 *
 * The governing rule is that **a valid cached bundle is always served,
 * whatever the current fetch attempt does**. A fetch can replace the served
 * bundle on success but never withdraws one on failure, so `ensure()` returns
 * undefined only when no valid cache exists.
 */
export class PositronDocsCache {

	constructor(private readonly _options: IPositronDocsCacheOptions) { }

	async ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		const { logger } = this._options;
		const resolved = resolveBundleRequest(request);
		const state = await this._readState();
		const cached = await this._readCached(state);

		// Terminal: a release build holding its own version never touches the
		// network again.
		if (cached && state?.resolution === 'exact') {
			logger.info(`${LOG_PREFIX} exact cache hit for ${state.version}; no network`);
			return cached;
		}

		const target = resolved.wantsExact ? resolved.exact : resolved.latest;
		const resolution: DocsResolution = resolved.wantsExact ? 'exact' : 'latest-by-policy';
		logger.info(`${LOG_PREFIX} fetching ${target.zipUrl} (${resolution})`);

		const outcome = await this._downloadAndInstall(target, resolution, state?.etag);
		if (outcome.kind === 'installed') {
			await this._recordInstall(outcome, request, resolved.exact.version, resolution, target);
			return outcome.docs;
		}
		this._logOutcome(outcome, target);

		// Cache-present rule: a failed attempt never withdraws a served bundle.
		return cached;
	}

	private _logOutcome(outcome: InstallOutcome, target: IResolvedBundle): void {
		const { logger } = this._options;
		switch (outcome.kind) {
			case 'rejected':
				logger.warn(`${LOG_PREFIX} rejected bundle from ${target.zipUrl}: ${outcome.reason}`);
				break;
			case 'failed':
				logger.info(`${LOG_PREFIX} fetch failed for ${target.zipUrl}: ${outcome.reason}`);
				break;
			case 'not-found':
				logger.info(`${LOG_PREFIX} no bundle published at ${target.zipUrl}`);
				break;
			case 'not-modified':
				logger.info(`${LOG_PREFIX} ${target.zipUrl} unchanged (304)`);
				break;
		}
	}

	private async _recordInstall(
		outcome: InstallOutcome & { kind: 'installed' },
		request: IDocsBundleRequest,
		requestedVersion: string,
		resolution: DocsResolution,
		target: IResolvedBundle,
	): Promise<void> {
		const now = this._options.now();
		await this._writeState({
			schema: DOCS_BUNDLE_SCHEMA,
			version: outcome.manifest.version,
			requestedVersion,
			resolution,
			profile: request.profile,
			sha256: outcome.digest,
			etag: outcome.etag,
			sourceUrl: target.zipUrl,
			fetchedAt: now,
			lastAttemptAt: now,
		});
		this._options.logger.info(`${LOG_PREFIX} installed ${outcome.manifest.version} from ${target.zipUrl}`);
	}

	/**
	 * Fetch, verify, extract, and swap in one bundle.
	 *
	 * Order matters: the zip is fetched first so a 404 reads as "not published
	 * yet" rather than as a verification failure, and the digest is checked
	 * before anything is extracted so a bad payload can never write to disk
	 * outside the staging directory.
	 */
	private async _downloadAndInstall(target: IResolvedBundle, resolution: DocsResolution, etag: string | undefined): Promise<InstallOutcome> {
		const { archive, files, http, newId } = this._options;
		const id = newId();
		const tmpZip = joinDocsPath(this._options.rootPath, `.tmp-${id}.zip`);
		const staging = joinDocsPath(this._options.rootPath, `.staging-${id}`);

		try {
			await files.mkdir(this._options.rootPath);

			const zip = await http.get(target.zipUrl, { etag, maxBytes: DOCS_MAX_DOWNLOAD_BYTES });
			if (zip.status === 304) {
				return { kind: 'not-modified' };
			}
			if (zip.status === 404) {
				return { kind: 'not-found' };
			}
			if (zip.status !== 200 || !zip.body) {
				return { kind: 'failed', reason: `HTTP ${zip.status}` };
			}

			// A zip that cannot be verified is never extracted, even though
			// that means a cold cache gets no local docs until the sidecar
			// appears. Proceeding unverified would make the digest decorative.
			const sidecar = await http.get(target.sha256Url);
			if (sidecar.status !== 200 || !sidecar.body) {
				return { kind: 'rejected', reason: `digest sidecar unavailable (HTTP ${sidecar.status})` };
			}
			const expected = parseSha256Sidecar(new TextDecoder().decode(sidecar.body));
			if (!expected) {
				return { kind: 'rejected', reason: 'digest sidecar is not a sha256 digest' };
			}

			await files.writeFile(tmpZip, zip.body);
			const actual = await files.sha256(tmpZip);
			if (actual !== expected) {
				return { kind: 'rejected', reason: `digest mismatch (expected ${expected}, got ${actual})` };
			}

			try {
				const offending = guardEntryNames(await archive.entryNames(tmpZip));
				if (offending) {
					return { kind: 'rejected', reason: `archive entry escapes the target: ${offending}` };
				}
				await archive.extract(tmpZip, staging);
			} catch (error) {
				return { kind: 'rejected', reason: `corrupt archive: ${errorMessage(error)}` };
			}

			const validation = await validateExtractedBundle(files, staging);
			if (!validation.ok) {
				return { kind: 'rejected', reason: `extracted bundle invalid (${validation.reason})` };
			}

			const docs = await this._swapIn(staging, validation.manifest, resolution, id);
			return { kind: 'installed', docs, manifest: validation.manifest, digest: actual, etag: zip.etag };
		} catch (error) {
			return { kind: 'failed', reason: errorMessage(error) };
		} finally {
			await this._safeDelete(tmpZip);
			await this._safeDelete(staging);
		}
	}

	/**
	 * Atomic swap. The rename means a killed process can never leave a
	 * half-populated version directory that later looks like a cache hit.
	 */
	private async _swapIn(staging: string, manifest: IDocsBundleManifest, resolution: DocsResolution, id: string): Promise<ILocalDocs> {
		const { files } = this._options;
		const target = joinDocsPath(this._options.rootPath, manifest.version);
		if (await files.exists(target)) {
			// Same version is already on disk but was not usable, or we would
			// not have downloaded. Move it aside first so the recorded path
			// never points at a directory that does not exist.
			const stale = joinDocsPath(this._options.rootPath, `.stale-${id}`);
			await files.rename(target, stale);
			await files.rename(staging, target);
			await this._safeDelete(stale);
		} else {
			await files.rename(staging, target);
		}
		return toLocalDocs(target, manifest, resolution === 'exact');
	}

	private async _readState(): Promise<IDocsCacheState | undefined> {
		const path = joinDocsPath(this._options.rootPath, DOCS_STATE_FILENAME);
		if (!await this._options.files.exists(path)) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(await this._options.files.readFile(path)) as IDocsCacheState;
			return typeof parsed?.version === 'string' ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	private async _writeState(state: IDocsCacheState): Promise<void> {
		const { files, newId, rootPath } = this._options;
		const tmp = joinDocsPath(rootPath, `.state-${newId()}.json`);
		await files.writeFile(tmp, JSON.stringify(state, undefined, '\t'));
		await files.rename(tmp, joinDocsPath(rootPath, DOCS_STATE_FILENAME));
	}

	/**
	 * Whether the bundle `state` names is usable.
	 *
	 * Note this never re-hashes: `state.sha256` is a diagnostic record of what
	 * was verified before extraction, not a live checksum. The structural
	 * checks here are the proportionate ones for Markdown the assistant reads
	 * as text.
	 */
	private async _readCached(state: IDocsCacheState | undefined): Promise<ILocalDocs | undefined> {
		// An empty version means `_recordFailure` wrote state with no bundle ever
		// installed. `joinDocsPath` drops empty segments, so computing the path
		// anyway would validate rootPath itself and warn that a cache which never
		// existed is now unusable.
		if (!state || !state.version) {
			return undefined;
		}
		const dir = joinDocsPath(this._options.rootPath, state.version);
		const validation = await validateExtractedBundle(this._options.files, dir);
		if (!validation.ok) {
			this._options.logger.warn(`${LOG_PREFIX} cached bundle at ${dir} is unusable (${validation.reason})`);
			return undefined;
		}
		return toLocalDocs(dir, validation.manifest, state.resolution === 'exact');
	}

	private async _safeDelete(path: string): Promise<void> {
		try {
			await this._options.files.delete(path);
		} catch {
			// Cleanup is best-effort; the prune pass collects anything left.
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Fill the inline snapshots and run the tests**

```bash
npx vitest run --update src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
```

**Read the two filled snapshots** and confirm:
- the `ILocalDocs` snapshot has `path: '/userdata/User/positron-docs/2026.05.0-179'`, `schema: 1`,
  `version: '2026.05.0-179'`, `profile: 'positron'`,
  `docsBaseUrl: 'https://positron.posit.co/'`, `isExactMatch: true`
- the state snapshot has `resolution: 'exact'`, `version` equal to `requestedVersion`, and
  `sourceUrl` equal to the exact zip URL

Then re-run without `--update`:

```bash
npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Type-check, lint, and commit**

```bash
npm run test:positron:check-ts 2>&1 | grep 'positronDocsCache.vitest.ts'
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git add src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git commit -m "Add docs cache install path with digest verification and extraction guards"
```

Expected from the grep: no output.

---

### Task 6: Version resolution, convergence, and the cache-present rule

**Files:**
- Modify: `src/vs/platform/positronDocs/common/positronDocsCache.ts`
- Modify: `src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`

**Interfaces:**
- Consumes: Task 5's `PositronDocsCache`
- Produces: no new public surface. `ensure()` keeps its signature; three private methods change shape.

**Three private signatures change in this task.** `isExactMatch` must be derived from truth rather
than from a persisted label, because after an app update a bundle recorded as `exact` no longer is:

| Before (Task 5) | After (Task 6) |
|---|---|
| `_downloadAndInstall(target, resolution, etag)` | `_downloadAndInstall(target, exactVersion, etag)` |
| `_swapIn(staging, manifest, resolution, id)` | `_swapIn(staging, manifest, exactVersion, id)` |
| `_readCached(state)` | `_readCached(state, exactVersion)` |

- [ ] **Step 1: Write the failing tests**

Append to `src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`:

```ts
describe('PositronDocsCache: convergence', () => {
	it('serves the fallback bundle first, then converges to exact', async () => {
		const ctx = setup();
		// Exact is not published yet; latest holds an older release's docs.
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.http.route(`${EXACT_ZIP}.sha256sum`, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');

		// Intermediate state matters: a test that checked only the end state
		// would pass even if the fallback never worked.
		const first = await ctx.cache.ensure(request());
		expect(first?.version).toBe('2026.04.0-100');
		expect(first?.isExactMatch).toBe(false);
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).resolution).toBe('fallback');

		// The release's docs publish. The next launch converges.
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const second = await ctx.cache.ensure(request());
		expect(second?.version).toBe('2026.05.0-179');
		expect(second?.isExactMatch).toBe(true);
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).resolution).toBe('exact');
	});

	it('keeps the cached bundle when latest answers 304', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());
		const before = ctx.files.listUnder(ROOT);

		const second = await ctx.cache.ensure(request());

		expect(second?.version).toBe('2026.04.0-100');
		expect(ctx.files.listUnder(ROOT)).toEqual(before);
		expect(ctx.logger.infos.join('\n')).toContain('unchanged (304)');
	});

	it('replaces the cached bundle when latest moves', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		const second = await ctx.cache.ensure(request());

		expect(second?.version).toBe('2026.05.0-179');
	});

	it('re-enters fallback when the app updates past the cached bundle', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		const first = await ctx.cache.ensure(request());
		expect(first?.isExactMatch).toBe(true);

		// The user updates to a release whose docs have not published yet.
		const updated = request({ positronVersion: '2026.06.0', positronBuildNumber: 42 });
		ctx.http.route(`${BASE}/positron-llms-2026.06.0-42.zip`, { status: 404 });
		ctx.http.route(LATEST_ZIP, { status: 404 });

		const second = await ctx.cache.ensure(updated);

		// Local docs never silently regress to web-only because of an update.
		expect(second?.version).toBe('2026.05.0-179');
		expect(second?.isExactMatch).toBe(false);
	});

	it('never HEADs the exact URL on a dailies build', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request({ quality: 'dailies' }));
		expect(ctx.http.headCalls).toEqual([]);
	});

	it('HEADs the exact URL again on the very next launch while in fallback', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());
		await ctx.cache.ensure(request());

		// The 404 convergence check is deliberately never throttled.
		expect(ctx.http.headCalls.filter(url => url === EXACT_ZIP)).toHaveLength(2);
	});
});

describe('PositronDocsCache: cache-present rule', () => {
	/** Install a good bundle, then break the next fetch in the given way. */
	async function withWarmCache(breakIt: (ctx: ReturnType<typeof setup>) => void) {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		const first = await ctx.cache.ensure(request({ quality: 'dailies' }));
		expect(first?.version).toBe('2026.04.0-100');

		breakIt(ctx);
		return { ctx, second: await ctx.cache.ensure(request({ quality: 'dailies' })) };
	}

	// This is the finding that broke the first draft of the design, so every
	// failure kind gets explicit coverage rather than one representative case.
	it.each([
		['network failure', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 0, throws: 'ENOTFOUND' })],
		['5xx', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 503 })],
		['404 on latest', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 404 })],
		['corrupt zip', (c: ReturnType<typeof setup>) => c.publish(LATEST_ZIP, 'not-a-zip')],
		['schema 2', (c: ReturnType<typeof setup>) => c.publish(LATEST_ZIP, fakeZip({
			'bundle.json': JSON.stringify({ schema: 2, profile: 'positron', version: 'v', generated: 'g', docsBaseUrl: 'd', fileCount: 2 }),
			'llms.txt': 'x',
		}))],
		['digest mismatch', (c: ReturnType<typeof setup>) => {
			c.http.route(LATEST_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${LATEST_ZIP}.sha256sum`, { status: 200, body: `${'d'.repeat(64)}  x` });
		}],
		['missing sidecar', (c: ReturnType<typeof setup>) => {
			c.http.route(LATEST_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${LATEST_ZIP}.sha256sum`, { status: 404 });
		}],
		['disk error', (c: ReturnType<typeof setup>) => {
			c.publish(LATEST_ZIP, payload('2026.05.0-179'));
			c.files.failWritesUnder = ROOT;
		}],
	])('still serves the warm cache after %s', async (_label, breakIt) => {
		const { ctx, second } = await withWarmCache(breakIt);

		expect(second?.version).toBe('2026.04.0-100');
		// The previously installed directory survives untouched.
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100/llms.txt`)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`
Expected: the new `convergence` cases FAIL (a release build currently downloads exact once and never
re-attempts). Some `cache-present rule` cases may already pass from Task 5's `return cached` - that is
fine, they are regression cover for this task's rewrite.

- [ ] **Step 3: Apply the three signature changes**

In `positronDocsCache.ts`:

1. `_downloadAndInstall(target: IResolvedBundle, exactVersion: string, etag: string | undefined)` -
   replace the `resolution: DocsResolution` parameter, and change its `_swapIn` call to
   `this._swapIn(staging, validation.manifest, exactVersion, id)`.
2. `_swapIn(staging: string, manifest: IDocsBundleManifest, exactVersion: string, id: string)` -
   replace the final line with:
   ```ts
   		return toLocalDocs(target, manifest, manifest.version === exactVersion);
   ```
3. `_readCached(state: IDocsCacheState | undefined, exactVersion: string)` - replace the final line
   with:
   ```ts
   		return toLocalDocs(dir, validation.manifest, validation.manifest.version === exactVersion);
   ```

Add a comment above `_readCached`'s new final line:

```ts
		// Derived from the running build, not from state.resolution: after an
		// app update a bundle recorded as `exact` no longer is one.
```

- [ ] **Step 4: Replace `ensure()` and add the two resolution branches**

Replace the whole `ensure()` method with:

```ts
	async ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		const resolved = resolveBundleRequest(request);
		const state = await this._readState();
		const cached = await this._readCached(state, resolved.exact.version);

		// Terminal: a release build already holding its own version never
		// touches the network again. Both halves matter - `resolution` alone
		// would keep an updated app pinned to its predecessor's docs.
		if (cached && state?.resolution === 'exact' && state.version === resolved.exact.version) {
			this._options.logger.info(`${LOG_PREFIX} exact cache hit for ${state.version}; no network`);
			return cached;
		}

		return resolved.wantsExact
			? await this._ensureRelease(request, resolved, state, cached)
			: await this._ensureLatest(request, resolved, state, cached);
	}

	/**
	 * Release channel: target the exact version, fall back to latest until it
	 * publishes, and keep converging on every launch.
	 */
	private async _ensureRelease(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
	): Promise<ILocalDocs | undefined> {
		const { http, logger } = this._options;

		// This convergence check is never throttled. A HEAD is a few hundred
		// bytes, and throttling it would let an install sit on a known-wrong
		// docs version longer than the fallback policy intends.
		let exactExists = false;
		try {
			exactExists = (await http.head(resolved.exact.zipUrl)).status === 200;
		} catch (error) {
			logger.info(`${LOG_PREFIX} exact HEAD failed for ${resolved.exact.zipUrl}: ${errorMessage(error)}`);
		}

		if (exactExists) {
			const outcome = await this._downloadAndInstall(resolved.exact, resolved.exact.version, undefined);
			if (outcome.kind === 'installed') {
				await this._recordInstall(outcome, request, resolved.exact.version, 'exact', resolved.exact);
				return outcome.docs;
			}
			this._logOutcome(outcome, resolved.exact);
		}

		return await this._fetchLatest(request, resolved, state, cached, 'fallback');
	}

	/** Dailies and dev builds: latest is the intended target, not a fallback. */
	private async _ensureLatest(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
	): Promise<ILocalDocs | undefined> {
		return await this._fetchLatest(request, resolved, state, cached, 'latest-by-policy');
	}

	private async _fetchLatest(
		request: IDocsBundleRequest,
		resolved: IResolvedBundleRequest,
		state: IDocsCacheState | undefined,
		cached: ILocalDocs | undefined,
		resolution: DocsResolution,
	): Promise<ILocalDocs | undefined> {
		// Conditional on the stored ETag. Using the `latest` alias rather than
		// comparing versions keeps this monotonic without a version comparator.
		const outcome = await this._downloadAndInstall(resolved.latest, resolved.exact.version, state?.etag);
		if (outcome.kind === 'installed') {
			await this._recordInstall(outcome, request, resolved.exact.version, resolution, resolved.latest);
			return outcome.docs;
		}
		this._logOutcome(outcome, resolved.latest);
		if (outcome.kind === 'not-modified' && state) {
			await this._touchState(state, resolution, resolved.exact.version);
		}

		// Cache-present rule: a failed attempt never withdraws a served bundle.
		return cached;
	}

	private async _touchState(state: IDocsCacheState, resolution: DocsResolution, requestedVersion: string): Promise<void> {
		const now = this._options.now();
		await this._writeState({ ...state, resolution, requestedVersion, fetchedAt: now, lastAttemptAt: now });
	}
```

Add `IResolvedBundleRequest` to the import list from `./positronDocsBundle.js`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`
Expected: PASS, including all eight `cache-present rule` cases and the intermediate-state assertion
in the convergence test.

- [ ] **Step 6: Type-check, lint, and commit**

```bash
npm run test:positron:check-ts 2>&1 | grep 'positronDocsCache.vitest.ts'
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git add src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git commit -m "Add docs cache version resolution, convergence, and cache-present rule"
```

---

### Task 7: Single-flight, pruning, and hard-failure throttling

**Files:**
- Modify: `src/vs/platform/positronDocs/common/positronDocsBundle.ts`
- Modify: `src/vs/platform/positronDocs/common/positronDocsCache.ts`
- Modify: `src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`

**Interfaces:**
- Produces, relied on by Task 12: `PositronDocsCache.invalidate(): void` - permits one more attempt
  this session, called when `ai.enabled` flips true.

- [ ] **Step 1: Add the two timing constants**

Append to `src/vs/platform/positronDocs/common/positronDocsBundle.ts`:

```ts
/**
 * How long a hard failure (network, DNS, connection, 5xx, disk) suppresses the
 * next attempt. This stops a persistent CDN or configuration problem turning
 * into a per-launch request from every install at once. Deliberately does NOT
 * apply to the 404 convergence check.
 */
export const DOCS_FAILURE_THROTTLE_MS = 60 * 60 * 1000;

/**
 * How long a transient `.tmp-*`, `.staging-*`, or `.stale-*` entry must have
 * been idle before pruning may remove it. Each window has its own extension
 * host sharing this cache directory, so anything younger may be another
 * window's in-flight work.
 */
export const DOCS_PRUNE_IDLE_MS = 10 * 60 * 1000;
```

- [ ] **Step 2: Make the test harness able to open a second session**

In `positronDocsCache.vitest.ts`, change `setup()` so the cache is built by a factory sharing the
same fakes, and expose it. Replace the `const cache = new PositronDocsCache({...});` line and the
returned object's `cache` field with:

```ts
	const makeCache = () => new PositronDocsCache({
		rootPath: ROOT, http, files, archive, logger,
		now: () => clock,
		newId: () => `id${++ids}`,
	});
	const cache = makeCache();
	return {
		cache, makeCache, files, http, archive, logger,
```

keeping the existing `advance` and `publish` entries. A fresh `makeCache()` stands in for a new
session: it re-reads `state.json` from the shared fake file store, exactly as a relaunch would.

- [ ] **Step 3: Write the failing tests**

Append to `positronDocsCache.vitest.ts`:

```ts
describe('PositronDocsCache: single flight', () => {
	it('joins two concurrent calls into one download', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const [a, b] = await Promise.all([ctx.cache.ensure(request()), ctx.cache.ensure(request())]);

		expect(a?.version).toBe('2026.05.0-179');
		expect(b?.version).toBe('2026.05.0-179');
		expect(ctx.http.getCalls.filter(url => url === EXACT_ZIP)).toHaveLength(1);
	});

	it('does not re-attempt within a session, but invalidate() permits one more', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.http.route(LATEST_ZIP, { status: 404 });
		await ctx.cache.ensure(request());
		const afterFirst = ctx.http.headCalls.length;

		await ctx.cache.ensure(request());
		expect(ctx.http.headCalls.length).toBe(afterFirst);

		// The one in-session re-attempt the spec allows: an ai.enabled flip.
		ctx.cache.invalidate();
		await ctx.cache.ensure(request());
		expect(ctx.http.headCalls.length).toBeGreaterThan(afterFirst);
	});
});

describe('PositronDocsCache: hard-failure throttling', () => {
	it('records lastFailureAt and skips the next session inside the window', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 503 });
		ctx.http.route(LATEST_ZIP, { status: 503 });
		await ctx.cache.ensure(request());
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).lastFailureAt).toBeDefined();

		ctx.advance(59 * 60 * 1000);
		const callsBefore = ctx.http.getCalls.length;
		await ctx.makeCache().ensure(request());

		expect(ctx.http.getCalls.length).toBe(callsBefore);
	});

	it('retries once the throttle window has passed', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 503 });
		ctx.http.route(LATEST_ZIP, { status: 503 });
		await ctx.cache.ensure(request());
		const callsBefore = ctx.http.getCalls.length;

		ctx.advance(61 * 60 * 1000);
		await ctx.makeCache().ensure(request());

		expect(ctx.http.getCalls.length).toBeGreaterThan(callsBefore);
	});

	it('does not throttle a 404, so convergence keeps running', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		const state = JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`));
		expect(state.lastFailureAt).toBeUndefined();

		ctx.advance(60 * 1000);
		await ctx.makeCache().ensure(request());
		expect(ctx.http.headCalls.filter(url => url === EXACT_ZIP)).toHaveLength(2);
	});
});

describe('PositronDocsCache: pruning', () => {
	it('deletes superseded version directories on success', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		await ctx.makeCache().ensure(request());

		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179/llms.txt`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100`)).toBe(false);
	});

	it('leaves another window in-flight temp entries alone but collects abandoned ones', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		// Two windows share this directory. A recent temp file belongs to a
		// live download; an old one is an abandoned leftover.
		await ctx.files.writeFile(`${ROOT}/.tmp-otherwindow.zip`, 'in flight');
		ctx.files.mtimes.set(`${ROOT}/.tmp-otherwindow.zip`, 1_000_000);
		await ctx.files.writeFile(`${ROOT}/.staging-abandoned/x`, 'stale');
		ctx.files.mtimes.set(`${ROOT}/.staging-abandoned`, 1_000_000 - 11 * 60 * 1000);

		await ctx.cache.ensure(request());

		expect(await ctx.files.exists(`${ROOT}/.tmp-otherwindow.zip`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/.staging-abandoned`)).toBe(false);
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`
Expected: FAIL - `ctx.cache.invalidate is not a function`, plus the throttle and prune assertions.

- [ ] **Step 5: Add single-flight, throttling, and pruning**

In `positronDocsCache.ts`:

1. Extend the import from `./positronDocsBundle.js` with `DOCS_FAILURE_THROTTLE_MS` and
   `DOCS_PRUNE_IDLE_MS`.

2. Add these fields at the top of the class body, above the constructor:

```ts
	private _inFlight: Promise<ILocalDocs | undefined> | undefined;
	private _attempted = false;
	private _result: ILocalDocs | undefined;
```

3. Rename the existing `ensure` to `_ensureOnce` (leave its body alone) and add the new public
   `ensure` above it:

```ts
	/**
	 * Resolve local docs, running at most one fetch at a time and at most one
	 * attempt per session. Concurrent callers join the in-flight operation
	 * rather than racing it.
	 */
	async ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		if (this._attempted) {
			return this._result;
		}
		if (this._inFlight) {
			return await this._inFlight;
		}
		this._inFlight = this._ensureOnce(request);
		try {
			this._result = await this._inFlight;
			this._attempted = true;
			return this._result;
		} finally {
			this._inFlight = undefined;
		}
	}

	/**
	 * Permit one more attempt this session. The only caller is the
	 * `ai.enabled` false-to-true transition, which is the single case the
	 * design allows to re-attempt without a relaunch.
	 */
	invalidate(): void {
		this._attempted = false;
		this._result = undefined;
	}
```

4. In `_ensureOnce`, immediately after the terminal exact-cache-hit block, add the throttle gate:

```ts
		const lastFailureAt = state?.lastFailureAt;
		if (lastFailureAt !== undefined && this._options.now() - lastFailureAt < DOCS_FAILURE_THROTTLE_MS) {
			this._options.logger.info(`${LOG_PREFIX} skipping fetch; a hard failure is still inside the throttle window`);
			return cached;
		}
```

5. In `_fetchLatest`, record hard failures. Replace `this._logOutcome(outcome, resolved.latest);`
   with:

```ts
		this._logOutcome(outcome, resolved.latest);
		if (outcome.kind === 'failed') {
			await this._recordFailure(state, request, resolved.exact.version, resolution, outcome.reason);
		}
```

6. Add the two new private methods at the end of the class:

```ts
	/**
	 * Persist a hard failure so the next session honours the throttle.
	 *
	 * `lastAttemptAt` records every attempt for diagnostics; `lastFailureAt` is
	 * the field the throttle reads. Keeping them separate avoids a bug where a
	 * successful 304 silently suppresses the next convergence check.
	 */
	private async _recordFailure(
		state: IDocsCacheState | undefined,
		request: IDocsBundleRequest,
		requestedVersion: string,
		resolution: DocsResolution,
		reason: string,
	): Promise<void> {
		const now = this._options.now();
		await this._writeState({
			schema: DOCS_BUNDLE_SCHEMA,
			version: state?.version ?? '',
			requestedVersion,
			resolution: state?.resolution ?? resolution,
			profile: request.profile,
			sha256: state?.sha256 ?? '',
			etag: state?.etag,
			sourceUrl: state?.sourceUrl ?? '',
			fetchedAt: state?.fetchedAt ?? 0,
			lastAttemptAt: now,
			lastFailureAt: now,
			lastError: reason,
		});
	}

	/**
	 * Drop superseded version directories and abandoned transient entries.
	 *
	 * The mtime guard is what makes this safe across windows: each window has
	 * its own extension host, so window A must not delete window B's in-flight
	 * `.tmp-*` or `.staging-*`. Only entries idle for ten minutes are touched,
	 * which are by definition leftovers. No lock file needed.
	 */
	private async _prune(keepVersion: string): Promise<void> {
		const { files, now, rootPath } = this._options;
		const cutoff = now() - DOCS_PRUNE_IDLE_MS;
		for (const name of await files.readdir(rootPath)) {
			if (name === DOCS_STATE_FILENAME || name === keepVersion) {
				continue;
			}
			const path = joinDocsPath(rootPath, name);
			if (name.startsWith('.')) {
				const mtime = await files.mtime(path);
				if (mtime === undefined || mtime > cutoff) {
					continue;
				}
			}
			await this._safeDelete(path);
		}
	}
```

7. Call the prune at the end of `_recordInstall`, after its `logger.info` line:

```ts
		await this._prune(outcome.manifest.version);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`
Expected: PASS, every case across all six describes.

- [ ] **Step 7: Run the whole platform module and check coverage**

```bash
npx vitest run src/vs/platform/positronDocs/
npx vitest run --coverage --coverage.include='**/positronDocs*.ts' src/vs/platform/positronDocs/
```

Expected: all green. Read the coverage table: `positronDocsCache.ts` branch coverage should be above
80%. Anything materially below that means a failure row in the spec's table has no test - find which
and add it rather than lowering the bar.

- [ ] **Step 8: Type-check, lint, and commit**

```bash
npm run test:positron:check-ts 2>&1 | grep 'positronDocs'
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/*.ts src/vs/platform/positronDocs/test/common/*.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsBundle.ts src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git add src/vs/platform/positronDocs/common/positronDocsBundle.ts src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts
git commit -m "Add docs cache single-flight, pruning, and hard-failure throttling"
```

**PR 2a boundary.** Everything through here is reviewable on its own: no wiring, no registration,
nothing instantiated at runtime. Push and open the PR before starting Task 8.

```bash
git push -u origin mi/bundle-docs
```

---

# Part C: the extension-host wiring (Positron PR 2b)

Small enough to review as a diff. Two upstream files change by one `registerSingleton` line each;
everything else is new or Positron-owned.

**Build daemons are needed from here on.** Start them before Task 8 and leave them running:

```bash
npm run build-ps        # check status
npm run build-start     # start any that are missing
```

### Task 8: Move AI_ENABLED_KEY somewhere the extension host can import it

**Files:**
- Create: `src/vs/workbench/contrib/positronAssistant/common/positronAIConfigurationKeys.ts`
- Modify: `src/vs/workbench/contrib/positronAssistant/common/positronAIConfiguration.ts`

**Interfaces:**
- Produces: `AI_ENABLED_KEY` importable without side effects. Task 12 imports it from the new module.

`positronAIConfiguration.ts` calls `Registry.as(...).registerConfiguration(...)` at module top level
(line 27). Importing it from the extension host would pull the configuration registry and `nls` into
the ext-host bundle and re-register the `ai` config node in a process that has no Settings UI. The
project rule is to import the constant rather than hard-code `'ai.enabled'`, so the constant moves to
a side-effect-free sibling and the registration stays put.

- [ ] **Step 1: Create the keys module**

Create `src/vs/workbench/contrib/positronAssistant/common/positronAIConfigurationKeys.ts` with the
standard copyright header and:

```ts
/**
 * Main switch for Positron's AI features. When off, all of Positron's AI
 * features (Next Edit Suggestions, notebook AI, console Fix/Explain, etc.) are
 * turned off.
 *
 * Owned by Positron. It sits above the Posit Assistant extension's
 * `assistant.enabled` (which controls the chat UI): Posit Assistant also reads
 * `ai.enabled`, so when it's off the assistant is off regardless of
 * `assistant.enabled`. This setting seeds the `ai.*` namespace for
 * Positron-owned AI configuration.
 *
 * This module is deliberately free of imports and side effects so processes
 * without a Settings UI - notably the extension host - can read the key without
 * pulling in the configuration registry or re-registering the `ai` node. The
 * registration itself lives in `positronAIConfiguration.ts`.
 */
export const AI_ENABLED_KEY = 'ai.enabled';
```

- [ ] **Step 2: Re-export from the original module**

In `positronAIConfiguration.ts`, delete lines 14-25 (the doc comment and the `export const`) and add
this import next to the existing ones:

```ts
import { AI_ENABLED_KEY } from './positronAIConfigurationKeys.js';
```

Then add a re-export just below the import block, so every existing importer keeps working unchanged:

```ts
// Re-exported so existing importers do not have to move. New callers outside
// the workbench (e.g. the extension host) should import the keys module
// directly to avoid this file's registerConfiguration side effect.
export { AI_ENABLED_KEY };
```

- [ ] **Step 3: Verify no importer broke**

```bash
npm run build-check 2>&1 | grep -i 'AI_ENABLED_KEY\|positronAIConfiguration'
```

Expected: no output. Read the full `build-check` output once; it reports the whole last compilation
cycle, not just this file.

- [ ] **Step 4: Run the assistant's existing tests**

```bash
npx vitest run src/vs/workbench/contrib/positronAssistant/
```

Expected: PASS, unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- src/vs/workbench/contrib/positronAssistant/common/positronAIConfigurationKeys.ts src/vs/workbench/contrib/positronAssistant/common/positronAIConfiguration.ts
git add src/vs/workbench/contrib/positronAssistant/common/positronAIConfigurationKeys.ts src/vs/workbench/contrib/positronAssistant/common/positronAIConfiguration.ts
git commit -m "Extract AI_ENABLED_KEY into a side-effect-free module"
```

---

### Task 9: Product configuration and the public API declaration

**Files:**
- Modify: `src/vs/base/common/product.ts` (inside the existing Positron block, near line 79)
- Modify: `product.json` (near line 7)
- Modify: `src/positron-dts/positron.d.ts` (a new `namespace docs`, placed after `namespace paths`,
  which ends at line 3437)

**Interfaces:**
- Produces: `product.positronLlmsDocsUrl?: string` and the `positron.docs` type surface. Tasks 11-13
  depend on both.

- [ ] **Step 1: Declare the product field**

In `src/vs/base/common/product.ts`, inside the existing `// --- Start Positron ---` block, directly
after the `positronBuildNumber` declaration (line 79):

```ts
	/**
	 * Base URL for the slim LLM docs bundles the AI assistant reads from disk.
	 * Overridden at runtime by the POSITRON_LLMS_DOCS_URL environment variable.
	 * Distinct from the docs *website* URL, which is a separate knob.
	 */
	readonly positronLlmsDocsUrl?: string;
```

- [ ] **Step 2: Ship the default**

In `product.json`, after the `"positronBuildNumber": 0,` line (line 7):

```json
	"positronLlmsDocsUrl": "https://cdn.posit.co/positron/releases/docs",
```

Docs bundles are published only under `releases/docs/`, since the website publishes at release time.
Dailies read from that same prefix via the `latest` alias.

- [ ] **Step 3: Declare the API**

In `src/positron-dts/positron.d.ts`, immediately after the closing brace of `namespace paths`
(line 3437), add:

```ts
	/**
	 * Access to Positron product documentation cached on disk.
	 */
	namespace docs {
		/**
		 * A bundle of Positron documentation available on the extension host's
		 * local filesystem.
		 */
		export interface LocalDocs {
			/** Absolute path of the extracted bundle root, on the extension host's filesystem. */
			readonly path: string;

			/** Bundle format version. Currently 1. */
			readonly schema: number;

			/** Docs version this bundle was generated from, e.g. '2026.05.0-179'. */
			readonly version: string;

			/** 'positron' or 'workbench'. */
			readonly profile: string;

			/** Base URL for building a citable web link to a page in this bundle. */
			readonly docsBaseUrl: string;

			/** True when the bundle matches the running build exactly. */
			readonly isExactMatch: boolean;
		}

		/**
		 * Get the locally cached Positron documentation, downloading it if it is
		 * not present yet.
		 *
		 * Safe to call per docs need: a successful result is cached in process,
		 * and concurrent calls join a single in-flight download rather than
		 * starting several. Waits at most 10 seconds for an in-flight download;
		 * on timeout the download continues in the background and is available
		 * to the next call.
		 *
		 * Resolves to `undefined` when there are no local docs, which means the
		 * caller should fall back to fetching documentation from the web. That
		 * is the only meaning of `undefined`.
		 *
		 * @returns A Thenable resolving to the local docs, or undefined.
		 */
		export function getLocalDocs(): Thenable<LocalDocs | undefined>;
	}
```

Note the style rules this matches, taken from `namespace paths`: `namespace` is not itself exported
(the enclosing `declare module 'positron'` handles that), every member inside uses `export`, every
declaration carries a `/** */` block, and async APIs return `Thenable<T>` rather than `Promise<T>`.

- [ ] **Step 4: Verify it compiles**

```bash
npm run build-check
```

Expected: no errors mentioning `product.ts`, `positron.d.ts`, or `positronLlmsDocsUrl`. Read the full
output.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- src/vs/base/common/product.ts product.json src/positron-dts/positron.d.ts
git add src/vs/base/common/product.ts product.json src/positron-dts/positron.d.ts
git commit -m "Declare positron.docs API surface and the LLM docs bundle URL"
```

---

### Task 10: The common service and the web-worker variant

**Files:**
- Create: `src/vs/workbench/api/common/positron/extHostDocs.ts`
- Modify: `src/vs/workbench/api/worker/extHost.worker.services.ts` (registrations at lines 22-26)

**Interfaces:**
- Produces, relied on by Tasks 11-13:
  - `IExtHostDocs` service decorator
  - `interface IExtHostDocs { _serviceBrand; getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> }`
  - `class WorkerExtHostDocs implements IExtHostDocs`

Both hosts must register this service: `createPositronApiFactoryAndRegisterActors` is
`invokeFunction`'d from the node host (`api/node/extHostExtensionService.ts:162`) *and* the worker
host (`api/worker/extHostExtensionService.ts:55`), so a node-only registration crashes the worker host
at startup.

- [ ] **Step 1: Write the common service file**

Create `src/vs/workbench/api/common/positron/extHostDocs.ts` with the standard copyright header and:

```ts
import type * as positron from 'positron';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IExtHostDocs = createDecorator<IExtHostDocs>('IExtHostDocs');

export interface IExtHostDocs {
	readonly _serviceBrand: undefined;

	/**
	 * Resolve the locally cached docs bundle, or undefined when there are none
	 * and the caller should use the web.
	 */
	getLocalDocs(): Promise<positron.docs.LocalDocs | undefined>;
}

/**
 * Web-worker extension host variant.
 *
 * Returns undefined rather than throwing NotSupportedError, because undefined
 * is already the documented "no local docs, use the web" contract - throwing
 * would force every caller to wrap the call in a try/catch to get the same
 * behaviour. There is nothing to download to: the worker host has no
 * filesystem, and base/node/zip.ts is node-layer only.
 */
export class WorkerExtHostDocs implements IExtHostDocs {
	readonly _serviceBrand: undefined;

	async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
		return undefined;
	}
}
```

- [ ] **Step 2: Register it in the worker host**

At the end of `src/vs/workbench/api/worker/extHost.worker.services.ts` (after line 26), add:

```ts

// --- Start Positron ---
// The Positron API factory runs in this host too, so positron.docs needs a
// registration here. The worker host has no filesystem, so it gets the
// always-undefined variant.
registerSingleton(IExtHostDocs, WorkerExtHostDocs, InstantiationType.Eager);
// --- End Positron ---
```

and add the import inside a matching marker pair at the end of the import block (after line 14):

```ts
// --- Start Positron ---
import { IExtHostDocs, WorkerExtHostDocs } from '../common/positron/extHostDocs.js';
// --- End Positron ---
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run build-check
```

Expected: no errors. Read the full output.

- [ ] **Step 4: Commit**

```bash
npm run precommit -- src/vs/workbench/api/common/positron/extHostDocs.ts src/vs/workbench/api/worker/extHost.worker.services.ts
git add src/vs/workbench/api/common/positron/extHostDocs.ts src/vs/workbench/api/worker/extHost.worker.services.ts
git commit -m "Add IExtHostDocs service and its web-worker variant"
```

---

### Task 11: Node port adapters, input derivation, and the node service

**Files:**
- Create: `src/vs/workbench/api/node/positron/extHostDocsNode.ts`
- Create: `src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts` (new directory:
  `api/test/node/positron/` does not exist yet, though `api/test/browser/positron/` and
  `api/test/common/positron/` do)
- Modify: `src/vs/workbench/api/node/extHost.node.services.ts` (registrations end at line 55)

**Interfaces:**
- Consumes: `PositronDocsCache`, the three port interfaces, `IExtHostDocs`, `AI_ENABLED_KEY`
- Produces, relied on by Tasks 12-13:
  - `export function deriveBundleRequest(initData: IExtHostInitDataService, env: NodeJS.ProcessEnv): IDocsBundleRequest`
  - `export class NodeExtHostDocs extends Disposable implements IExtHostDocs`

`deriveBundleRequest` is a free exported function rather than a private method so the test can call it
directly without reaching into class internals.

- [ ] **Step 1: Write the failing test**

Create `src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IExtHostInitDataService } from '../../../common/extHostInitDataService.js';
import { deriveBundleRequest } from '../../../node/positron/extHostDocsNode.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

function initData(overrides: { quality?: string; version?: string; build?: number } = {}) {
	return stubInterface<IExtHostInitDataService>({
		quality: 'quality' in overrides ? overrides.quality : 'releases',
		positronVersion: overrides.version ?? '2026.05.0',
		positronBuildNumber: overrides.build ?? 179,
		environment: stubInterface<IExtHostInitDataService['environment']>({
			globalStorageHome: URI.file('/userdata/User/globalStorage'),
		}),
	});
}

describe('deriveBundleRequest', () => {
	it('reads version, build number, and quality from init data', () => {
		expect(deriveBundleRequest(initData(), {})).toMatchObject({
			quality: 'releases',
			positronVersion: '2026.05.0',
			positronBuildNumber: 179,
		});
	});

	it('falls back to the product.json default when no env override is set', () => {
		expect(deriveBundleRequest(initData(), {}).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('lets POSITRON_LLMS_DOCS_URL take precedence over the product.json value', () => {
		// This override is what makes the feature verifiable on demand against
		// a local fixture server, since product.json is baked at build time.
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: 'http://127.0.0.1:8099/docs' }).baseUrl)
			.toBe('http://127.0.0.1:8099/docs');
	});

	it('ignores an empty POSITRON_LLMS_DOCS_URL rather than building a relative URL', () => {
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: '' }).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('resolves the profile to positron on desktop', () => {
		// isWorkbench is false in the Vitest process, which has no RS_SERVER_URL.
		expect(deriveBundleRequest(initData(), {}).profile).toBe('positron');
	});

	it('passes an undefined quality through for dev builds', () => {
		expect(deriveBundleRequest(initData({ quality: undefined }), {}).quality).toBeUndefined();
	});
});

describe('NodeExtHostDocs construction', () => {
	// The one risk specific to hosting this on the extension host is a slow or
	// hung download landing on an activation path. The constructor must only
	// install a scheduler and a config listener, so it must not have created
	// the cache directory or resolved the barrier-gated config provider.
	it('performs no filesystem or configuration work', async () => {
		const root = join(tmpdir(), `positron-docs-ctor-${randomUUID()}`);
		const getConfigProvider = vi.fn(() => new Promise<never>(() => { }));
		const service = new NodeExtHostDocs(
			stubInterface<IExtHostInitDataService>({
				quality: 'dailies',
				positronVersion: '2026.05.0',
				positronBuildNumber: 179,
				environment: stubInterface<IExtHostInitDataService['environment']>({
					globalStorageHome: URI.file(join(root, 'globalStorage')),
				}),
			}),
			stubInterface<IExtHostConfiguration>({ getConfigProvider }),
			new NullLogService(),
		);

		expect(existsSync(join(root, 'positron-docs'))).toBe(false);
		service.dispose();
	});
});
```

Add these imports to the test file's header block:

```ts
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IExtHostConfiguration } from '../../../common/extHostConfiguration.js';
import { NodeExtHostDocs } from '../../../node/positron/extHostDocsNode.js';
```

and extend the existing `deriveBundleRequest` import to
`import { deriveBundleRequest, NodeExtHostDocs } from '...'` rather than importing it twice.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts`
Expected: FAIL, cannot resolve `../../../node/positron/extHostDocsNode.js`.

- [ ] **Step 3: Write the node service and its adapters**

Create `src/vs/workbench/api/node/positron/extHostDocsNode.ts` with the standard copyright header
and:

```ts
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import type * as positron from 'positron';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWorkbench } from '../../../../base/common/platform.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import * as pfs from '../../../../base/node/pfs.js';
import { extract } from '../../../../base/node/zip.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import product from '../../../../platform/product/common/product.js';
import { DocsProfile, IDocsBundleRequest } from '../../../../platform/positronDocs/common/positronDocsBundle.js';
import { PositronDocsCache } from '../../../../platform/positronDocs/common/positronDocsCache.js';
import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsHttpGetOptions, IDocsHttpResponse } from '../../../../platform/positronDocs/common/positronDocsPorts.js';
import { AI_ENABLED_KEY } from '../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';
import { IExtHostConfiguration } from '../../common/extHostConfiguration.js';
import { IExtHostInitDataService } from '../../common/extHostInitDataService.js';
import { IExtHostDocs } from '../../common/positron/extHostDocs.js';

const CACHE_DIR_NAME = 'positron-docs';
const DEFAULT_BUNDLE_BASE_URL = 'https://cdn.posit.co/positron/releases/docs';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

/**
 * HTTP over node's https/http. The extension host already proxy-patches these
 * modules, so enterprise proxies work with no extra code here.
 */
class NodeDocsHttpClient implements IDocsHttpClient {

	async get(url: string, options: IDocsHttpGetOptions = {}): Promise<IDocsHttpResponse> {
		return await this._request(url, 'GET', options, 0);
	}

	async head(url: string): Promise<IDocsHttpResponse> {
		return await this._request(url, 'HEAD', {}, 0);
	}

	private _request(url: string, method: 'GET' | 'HEAD', options: IDocsHttpGetOptions, redirects: number): Promise<IDocsHttpResponse> {
		return new Promise<IDocsHttpResponse>((resolve, reject) => {
			const headers: Record<string, string> = {};
			if (options.etag) {
				headers['If-None-Match'] = options.etag;
			}
			const transport = url.startsWith('http:') ? http : https;
			const request = transport.request(url, { method, headers, timeout: REQUEST_TIMEOUT_MS }, response => {
				const status = response.statusCode ?? 0;
				const location = response.headers.location;

				if (status >= 300 && status < 400 && location) {
					response.resume();
					if (redirects >= MAX_REDIRECTS) {
						reject(new Error(`too many redirects for ${url}`));
						return;
					}
					resolve(this._request(new URL(location, url).toString(), method, options, redirects + 1));
					return;
				}

				const etag = typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
				if (method === 'HEAD' || status === 304 || status !== 200) {
					response.resume();
					resolve({ status, etag });
					return;
				}

				const chunks: Buffer[] = [];
				let total = 0;
				response.on('data', (chunk: Buffer) => {
					total += chunk.length;
					if (options.maxBytes !== undefined && total > options.maxBytes) {
						// A wrong or hostile object must not be able to fill the disk.
						request.destroy();
						reject(new Error(`response from ${url} exceeds ${options.maxBytes} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => resolve({ status, etag, body: new Uint8Array(Buffer.concat(chunks)) }));
				response.on('error', reject);
			});
			request.on('timeout', () => request.destroy(new Error(`request to ${url} timed out`)));
			request.on('error', reject);
			request.end();
		});
	}
}

class NodeDocsFileStore implements IDocsFileStore {

	async exists(target: string): Promise<boolean> {
		return await pfs.Promises.exists(target);
	}

	async readFile(target: string): Promise<string> {
		return await fs.promises.readFile(target, 'utf8');
	}

	async writeFile(target: string, data: string | Uint8Array): Promise<void> {
		await fs.promises.mkdir(path.dirname(target), { recursive: true });
		await pfs.Promises.writeFile(target, data);
	}

	async mkdir(target: string): Promise<void> {
		await fs.promises.mkdir(target, { recursive: true });
	}

	async rename(from: string, to: string): Promise<void> {
		await pfs.Promises.rename(from, to);
	}

	async delete(target: string): Promise<void> {
		await pfs.Promises.rm(target);
	}

	/** Empty array for a missing path, and for a file, which is how the
	 * validator distinguishes leaves from directories. */
	async readdir(target: string): Promise<string[]> {
		try {
			return await pfs.Promises.readdir(target);
		} catch {
			return [];
		}
	}

	async mtime(target: string): Promise<number | undefined> {
		try {
			return (await fs.promises.stat(target)).mtimeMs;
		} catch {
			return undefined;
		}
	}

	async sha256(target: string): Promise<string> {
		return createHash('sha256').update(await fs.promises.readFile(target)).digest('hex');
	}
}

class NodeDocsArchive implements IDocsArchive {

	/**
	 * List entries without extracting, so the traversal guard runs first.
	 *
	 * base/node/zip.ts does not export an entry-listing helper, and its own
	 * check (`targetDirName.startsWith(targetPath)`) is a prefix test that
	 * ignores the final path segment. The archive arrives over the network, so
	 * we open it with yauzl ourselves and assert before writing anything.
	 */
	async entryNames(zipPath: string): Promise<string[]> {
		const { open } = await import('yauzl');
		return await new Promise<string[]>((resolve, reject) => {
			open(zipPath, { lazyEntries: true }, (error, zipfile) => {
				if (error || !zipfile) {
					reject(error ?? new Error(`could not open ${zipPath}`));
					return;
				}
				const names: string[] = [];
				zipfile.on('entry', entry => {
					names.push(entry.fileName);
					zipfile.readEntry();
				});
				zipfile.on('end', () => resolve(names));
				zipfile.on('error', reject);
				zipfile.readEntry();
			});
		});
	}

	async extract(zipPath: string, targetPath: string): Promise<void> {
		await extract(zipPath, targetPath, {}, CancellationToken.None);
	}
}

/**
 * Work out what this build should ask the CDN for.
 *
 * Exported as a free function so it is testable without constructing the
 * service or reaching into its internals.
 */
export function deriveBundleRequest(initData: IExtHostInitDataService, env: NodeJS.ProcessEnv): IDocsBundleRequest {
	const override = env['POSITRON_LLMS_DOCS_URL'];
	return {
		quality: initData.quality,
		positronVersion: initData.positronVersion,
		positronBuildNumber: initData.positronBuildNumber,
		// isWorkbench is already `!!process.env.RS_SERVER_URL` on the node side.
		profile: (isWorkbench ? 'workbench' : 'positron') as DocsProfile,
		baseUrl: (override && override.length > 0)
			? override
			: (product.positronLlmsDocsUrl ?? DEFAULT_BUNDLE_BASE_URL),
	};
}

export class NodeExtHostDocs extends Disposable implements IExtHostDocs {

	readonly _serviceBrand: undefined;

	private readonly _cache: PositronDocsCache;
	private readonly _request: IDocsBundleRequest;

	constructor(
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostConfiguration private readonly _configuration: IExtHostConfiguration,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// A sibling of globalStorage, so there is no risk of colliding with an
		// extension id. Profile-scoped, which is one 655KB copy per profile.
		const root = joinPath(dirname(initData.environment.globalStorageHome), CACHE_DIR_NAME);

		this._request = deriveBundleRequest(initData, process.env);
		this._cache = new PositronDocsCache({
			rootPath: root.fsPath,
			http: new NodeDocsHttpClient(),
			files: new NodeDocsFileStore(),
			archive: new NodeDocsArchive(),
			logger: {
				info: message => this._logService.info(message),
				warn: message => this._logService.warn(message),
			},
			now: () => Date.now(),
			newId: () => generateUuid(),
		});
	}

	async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
		if (!await this._isAiEnabled()) {
			return undefined;
		}
		return await this._cache.ensure(this._request);
	}

	/**
	 * Read live rather than caching at construction: ai.enabled is
	 * WINDOW-scoped and toggles without a reload, so a value captured once in
	 * the constructor goes stale.
	 */
	private async _isAiEnabled(): Promise<boolean> {
		const provider = await this._configuration.getConfigProvider();
		return provider.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true;
	}
}
```

- [ ] **Step 4: Register it in the node host**

At the end of `src/vs/workbench/api/node/extHost.node.services.ts` (after line 55), add:

```ts

// --- Start Positron ---
// Eager so the launch trigger has something to fire from. The constructor only
// installs a scheduler and a config listener; it never touches the network.
registerSingleton(IExtHostDocs, NodeExtHostDocs, InstantiationType.Eager);
// --- End Positron ---
```

and the import at the end of the import block (after line 33):

```ts
// --- Start Positron ---
import { IExtHostDocs } from '../common/positron/extHostDocs.js';
import { NodeExtHostDocs } from './positron/extHostDocsNode.js';
// --- End Positron ---
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts`
Expected: PASS, all six cases.

- [ ] **Step 6: Verify it compiles and commit**

```bash
npm run build-check
npm run test:positron:check-ts 2>&1 | grep 'extHostDocsNode.vitest.ts'
npx eslint --max-warnings 0 src/vs/workbench/api/node/positron/extHostDocsNode.ts src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts
npm run precommit -- src/vs/workbench/api/node/positron/extHostDocsNode.ts src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts src/vs/workbench/api/node/extHost.node.services.ts
git add src/vs/workbench/api/node/positron/extHostDocsNode.ts src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts src/vs/workbench/api/node/extHost.node.services.ts
git commit -m "Add node docs port adapters and the extension-host docs service"
```

Expected: `build-check` clean, grep silent.

---

### Task 12: Triggers, gating, and the bounded wait

**Files:**
- Create: `src/vs/platform/positronDocs/common/positronDocsTriggers.ts`
- Create: `src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts`
- Modify: `src/vs/platform/positronDocs/common/positronDocsCache.ts` (add `peek`)
- Modify: `src/vs/workbench/api/node/positron/extHostDocsNode.ts`

**Interfaces:**
- Produces, relied on by Task 13:
  - `PositronDocsCache.peek(request): Promise<ILocalDocs | undefined>` - cached result only, no network
  - `interface IDocsCacheLike { ensure; peek; invalidate }`
  - `class PositronDocsTriggers { runBackgroundFetch(); getLocalDocs(); onAiEnabledFlippedTrue() }`

The trigger logic lives in `common` rather than in the extension-host class so it is testable with no
DI container and no ext-host stubs. `NodeExtHostDocs` keeps only the `RunOnceScheduler` and the
configuration subscription, which is what makes "constructing the service performs zero port calls"
easy to hold true.

- [ ] **Step 1: Add `peek` to the cache**

In `positronDocsCache.ts`, add after the `invalidate()` method:

```ts
	/**
	 * The cached bundle, if any, without touching the network.
	 *
	 * Used when a caller has stopped waiting for an in-flight fetch: the
	 * cache-present rule says a valid cache is served regardless, and awaiting
	 * `ensure()` would defeat the point of the timeout.
	 */
	async peek(request: IDocsBundleRequest): Promise<ILocalDocs | undefined> {
		if (this._attempted) {
			return this._result;
		}
		const exactVersion = resolveBundleRequest(request).exact.version;
		return await this._readCached(await this._readState(), exactVersion);
	}
```

- [ ] **Step 2: Write the failing test**

Create `src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { IDocsBundleRequest } from '../../common/positronDocsBundle.js';
import { ILocalDocs } from '../../common/positronDocsPorts.js';
import { IDocsCacheLike, PositronDocsTriggers } from '../../common/positronDocsTriggers.js';
import { recordingLogger } from './fakes.js';

const REQUEST: IDocsBundleRequest = {
	quality: 'dailies', positronVersion: '2026.05.0', positronBuildNumber: 179,
	profile: 'positron', baseUrl: 'https://cdn.posit.co/positron/releases/docs',
};

const DOCS: ILocalDocs = {
	path: '/cache/2026.05.0-179', schema: 1, version: '2026.05.0-179',
	profile: 'positron', docsBaseUrl: 'https://positron.posit.co/', isExactMatch: true,
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve };
}

function setup(options: { aiEnabled?: boolean; peeked?: ILocalDocs } = {}) {
	const ensureGate = deferred<ILocalDocs | undefined>();
	const timeoutGate = deferred<void>();
	const ensure = vi.fn(() => ensureGate.promise);
	const peek = vi.fn(async () => options.peeked);
	const invalidate = vi.fn();
	const cache: IDocsCacheLike = { ensure, peek, invalidate };
	const logger = recordingLogger();
	const triggers = new PositronDocsTriggers({
		cache, request: REQUEST, logger,
		isAiEnabled: async () => options.aiEnabled ?? true,
		waitMs: 10_000,
		delay: () => timeoutGate.promise,
	});
	return { triggers, ensure, peek, invalidate, logger, ensureGate, timeoutGate };
}

describe('PositronDocsTriggers: ai.enabled gating', () => {
	it('does not fetch on launch when ai.enabled is false', async () => {
		const ctx = setup({ aiEnabled: false });
		await ctx.triggers.runBackgroundFetch();
		expect(ctx.ensure).not.toHaveBeenCalled();
	});

	it('returns undefined from getLocalDocs without touching the cache when ai.enabled is false', async () => {
		const ctx = setup({ aiEnabled: false });
		expect(await ctx.triggers.getLocalDocs()).toBeUndefined();
		expect(ctx.ensure).not.toHaveBeenCalled();
		expect(ctx.peek).not.toHaveBeenCalled();
	});

	it('fetches on launch when ai.enabled is true', async () => {
		const ctx = setup();
		const running = ctx.triggers.runBackgroundFetch();
		ctx.ensureGate.resolve(DOCS);
		await running;
		expect(ctx.ensure).toHaveBeenCalledTimes(1);
	});

	it('invalidates and refetches when ai.enabled flips true', async () => {
		const ctx = setup();
		const running = ctx.triggers.onAiEnabledFlippedTrue();
		ctx.ensureGate.resolve(DOCS);
		await running;
		expect(ctx.invalidate).toHaveBeenCalledTimes(1);
		expect(ctx.ensure).toHaveBeenCalledTimes(1);
	});
});

describe('PositronDocsTriggers: joining and the bounded wait', () => {
	it('joins an in-flight fetch rather than starting a second', async () => {
		const ctx = setup();
		const background = ctx.triggers.runBackgroundFetch();
		const first = ctx.triggers.getLocalDocs();
		const second = ctx.triggers.getLocalDocs();
		ctx.ensureGate.resolve(DOCS);

		expect(await first).toEqual(DOCS);
		expect(await second).toEqual(DOCS);
		await background;
		// The cache single-flights, so every caller lands on one ensure().
		expect(ctx.ensure).toHaveBeenCalledTimes(1);
	});

	it('returns the existing cached bundle on timeout, and does not cancel the fetch', async () => {
		const ctx = setup({ peeked: DOCS });
		const pending = ctx.triggers.getLocalDocs();
		ctx.timeoutGate.resolve();

		expect(await pending).toEqual(DOCS);
		expect(ctx.peek).toHaveBeenCalledTimes(1);
		expect(ctx.logger.infos.join('\n')).toContain('continuing in the background');

		// The download was never cancelled; only the caller stopped waiting.
		ctx.ensureGate.resolve(DOCS);
		expect(await ctx.triggers.getLocalDocs()).toEqual(DOCS);
	});

	it('returns undefined on timeout with a cold cache', async () => {
		const ctx = setup({ peeked: undefined });
		const pending = ctx.triggers.getLocalDocs();
		ctx.timeoutGate.resolve();
		expect(await pending).toBeUndefined();
	});

	it('swallows a fetch rejection so a background trigger never throws', async () => {
		const ctx = setup();
		const ensure = vi.fn(async () => { throw new Error('boom'); });
		const triggers = new PositronDocsTriggers({
			cache: { ensure, peek: async () => undefined, invalidate: vi.fn() },
			request: REQUEST, logger: ctx.logger,
			isAiEnabled: async () => true, waitMs: 10_000, delay: () => new Promise(() => { }),
		});

		await expect(triggers.runBackgroundFetch()).resolves.toBeUndefined();
		expect(ctx.logger.warns.join('\n')).toContain('boom');
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts`
Expected: FAIL, cannot resolve `../../common/positronDocsTriggers.js`.

- [ ] **Step 4: Write the triggers module**

Create `src/vs/platform/positronDocs/common/positronDocsTriggers.ts` with the standard copyright
header and:

```ts
import { IDocsBundleRequest } from './positronDocsBundle.js';
import { IDocsLogger, ILocalDocs } from './positronDocsPorts.js';

const LOG_PREFIX = '[positron-docs]';

/** The slice of PositronDocsCache the triggers need. */
export interface IDocsCacheLike {
	ensure(request: IDocsBundleRequest): Promise<ILocalDocs | undefined>;
	peek(request: IDocsBundleRequest): Promise<ILocalDocs | undefined>;
	invalidate(): void;
}

export interface IPositronDocsTriggersOptions {
	readonly cache: IDocsCacheLike;
	readonly request: IDocsBundleRequest;
	readonly logger: IDocsLogger;
	/** Read live: ai.enabled is WINDOW-scoped and toggles without a reload. */
	readonly isAiEnabled: () => Promise<boolean>;
	/** How long getLocalDocs() waits for an in-flight fetch. */
	readonly waitMs: number;
	/** Injected so tests control the timeout without fake timers. */
	readonly delay: (ms: number) => Promise<void>;
}

const TIMED_OUT = Symbol('timed-out');

/**
 * The three entry points into one operation.
 *
 * Launch and config-flip are fire-and-forget with no timeout, since nothing is
 * waiting on them. Only `getLocalDocs()` is bounded, because a slow link must
 * not stall an assistant response.
 */
export class PositronDocsTriggers {

	constructor(private readonly _options: IPositronDocsTriggersOptions) { }

	/** Launch trigger, and the tail of a config flip. Never throws. */
	async runBackgroundFetch(): Promise<void> {
		if (!await this._options.isAiEnabled()) {
			this._options.logger.info(`${LOG_PREFIX} ai.enabled is off; not fetching docs`);
			return;
		}
		try {
			await this._options.cache.ensure(this._options.request);
		} catch (error) {
			// A background trigger has no caller to surface this to, and a docs
			// download failing is not worth interrupting anyone over.
			this._options.logger.warn(`${LOG_PREFIX} background docs fetch failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** ai.enabled false-to-true: the one in-session re-attempt the design allows. */
	async onAiEnabledFlippedTrue(): Promise<void> {
		this._options.cache.invalidate();
		await this.runBackgroundFetch();
	}

	/**
	 * First-need trigger. Starts the operation if idle, joins it if in flight,
	 * or returns the completed result.
	 */
	async getLocalDocs(): Promise<ILocalDocs | undefined> {
		const { cache, delay, logger, request, waitMs } = this._options;
		if (!await this._options.isAiEnabled()) {
			return undefined;
		}

		const fetching = cache.ensure(request).catch(error => {
			logger.warn(`${LOG_PREFIX} docs fetch failed: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		});
		const timingOut = delay(waitMs).then(() => TIMED_OUT as typeof TIMED_OUT);

		const winner = await Promise.race([fetching, timingOut]);
		if (winner !== TIMED_OUT) {
			return winner;
		}

		// The download continues in the background and is available to the next
		// call; only this caller stops waiting. The cache-present rule still
		// applies, so hand back whatever is already on disk.
		logger.info(`${LOG_PREFIX} local docs not ready within ${waitMs}ms; continuing in the background`);
		return await cache.peek(request);
	}
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts`
Expected: PASS, all eight cases.

- [ ] **Step 6: Wire the triggers into `NodeExtHostDocs`**

In `extHostDocsNode.ts`:

1. Extend imports:

```ts
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { PositronDocsTriggers } from '../../../../platform/positronDocs/common/positronDocsTriggers.js';
```

2. Add the constant near the others:

```ts
const LAUNCH_DELAY_MS = 5_000;
const GET_LOCAL_DOCS_WAIT_MS = 10_000;
```

3. Replace the class fields and the whole constructor body. The cache becomes a constructor-local,
   since only the triggers need it now:

```ts
	private readonly _triggers: PositronDocsTriggers;

	constructor(
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostConfiguration private readonly _configuration: IExtHostConfiguration,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// A sibling of globalStorage, so there is no risk of colliding with an
		// extension id. Profile-scoped, which is one 655KB copy per profile.
		const root = joinPath(dirname(initData.environment.globalStorageHome), CACHE_DIR_NAME);
		const request = deriveBundleRequest(initData, process.env);
		const logger = {
			info: (message: string) => this._logService.info(message),
			warn: (message: string) => this._logService.warn(message),
		};

		const cache = new PositronDocsCache({
			rootPath: root.fsPath,
			http: new NodeDocsHttpClient(),
			files: new NodeDocsFileStore(),
			archive: new NodeDocsArchive(),
			logger,
			now: () => Date.now(),
			newId: () => generateUuid(),
		});

		this._triggers = new PositronDocsTriggers({
			cache,
			request,
			logger,
			isAiEnabled: () => this._isAiEnabled(),
			waitMs: GET_LOCAL_DOCS_WAIT_MS,
			delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
		});

		// Launch trigger. Nothing above touched the network or the disk: the
		// constructor only installs a scheduler and a config listener. That
		// discipline is what keeps a slow download off the extension
		// activation path, and Task 11's test asserts it.
		const launch = this._register(new RunOnceScheduler(() => { void this._triggers.runBackgroundFetch(); }, LAUNCH_DELAY_MS));
		launch.schedule();

		void this._listenForAiEnabledFlip();
	}
```

The `_cache` and `_request` fields are gone; delete their declarations.

4. Replace `getLocalDocs` and `_isAiEnabled` with these three methods:

```ts
	async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
		return await this._triggers.getLocalDocs();
	}

	/**
	 * ai.enabled toggles without a window reload, so a mid-session flip must
	 * work. getConfigProvider() is barrier-gated, hence the async helper rather
	 * than an inline subscription.
	 */
	private async _listenForAiEnabledFlip(): Promise<void> {
		const provider = await this._configuration.getConfigProvider();
		if (this._store.isDisposed) {
			return;
		}
		let enabled = provider.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true;
		this._register(provider.onDidChangeConfiguration(async event => {
			if (!event.affectsConfiguration(AI_ENABLED_KEY)) {
				return;
			}
			const next = provider.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true;
			const flippedOn = next && !enabled;
			enabled = next;
			if (flippedOn) {
				await this._triggers.onAiEnabledFlippedTrue();
			}
		}));
	}

	private async _isAiEnabled(): Promise<boolean> {
		const provider = await this._configuration.getConfigProvider();
		return provider.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true;
	}
```

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run src/vs/platform/positronDocs/
npm run build-check
npm run test:positron:check-ts 2>&1 | grep 'positronDocsTriggers.vitest.ts'
npx eslint --max-warnings 0 src/vs/platform/positronDocs/common/positronDocsTriggers.ts src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts src/vs/workbench/api/node/positron/extHostDocsNode.ts
npm run precommit -- src/vs/platform/positronDocs/common/positronDocsTriggers.ts src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts src/vs/workbench/api/node/positron/extHostDocsNode.ts
git add src/vs/platform/positronDocs/common/positronDocsTriggers.ts src/vs/platform/positronDocs/common/positronDocsCache.ts src/vs/platform/positronDocs/test/common/positronDocsTriggers.vitest.ts src/vs/workbench/api/node/positron/extHostDocsNode.ts
git commit -m "Add docs fetch triggers with ai.enabled gating and a bounded wait"
```

---

### Task 13: Expose the namespace and validate end to end

**Files:**
- Modify: `src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts` (accessor block at
  lines 61-67; the returned object literal at lines 646-693, where `paths,` appears)

**Interfaces:**
- Consumes: `IExtHostDocs` from Task 10, the type declaration from Task 9
- Produces: `positron.docs.getLocalDocs()` reaching real extensions

- [ ] **Step 1: Acquire the service**

In `extHost.positron.api.impl.ts`, add the import alongside the other Positron extHost imports:

```ts
import { IExtHostDocs } from './extHostDocs.js';
```

and in the accessor block (after `const extHostConfiguration = accessor.get(IExtHostConfiguration);`,
line 67):

```ts
	const extHostDocs = accessor.get(IExtHostDocs);
```

- [ ] **Step 2: Build the namespace**

Directly above the `const workspace: typeof positron.workspace = {` declaration (line 637), add:

```ts
		const docs: typeof positron.docs = {
			/**
			 * Get the locally cached Positron documentation, or undefined when
			 * the caller should fall back to the web.
			 */
			async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
				return await extHostDocs.getLocalDocs();
			},
		};
```

- [ ] **Step 3: Return it**

In the returned object literal, add `docs,` immediately after `paths,`:

```ts
			paths,
			docs,
			connections,
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run build-check
```

Expected: no errors. Read the full output.

- [ ] **Step 5: Run every test this plan added, plus the neighbours it touched**

```bash
npx vitest run src/vs/platform/positronDocs/ src/vs/workbench/api/test/ src/vs/workbench/contrib/positronAssistant/
```

Expected: PASS. Record the total count; this is the number to quote when reporting the work done.

- [ ] **Step 6: Commit**

```bash
npm run precommit -- src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts
git add src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts
git commit -m "Expose the positron.docs namespace to extensions"
```

- [ ] **Step 7: Set up a local fixture server for manual validation**

`product.json` is baked at build time, so the `POSITRON_LLMS_DOCS_URL` override is what makes this
verifiable without a custom build. **The server must host sidecars**: for every `<name>.zip` it needs
a `<name>.zip.sha256sum` beside it, or every request lands on the sidecar-404 path and
`getLocalDocs()` returns `undefined` with only a warn log to explain it - which reads as "the feature
is broken" rather than "the fixture is incomplete".

```bash
SCRATCH=/private/tmp/claude-502/-Users-marieidleman--superset-worktrees-positron-mi-bundle-docs/6f516860-8481-4c17-b980-ff2b047aa8f7/scratchpad
mkdir -p "$SCRATCH/docsfix/build/release-notes" && cd "$SCRATCH/docsfix/build"
printf '# Positron\n\n## Pages\n\n- [Welcome](welcome.llms.md)\n- [May](release-notes/release-2026-05.llms.md)\n' > llms.txt
printf '# Welcome\n\nLocal docs are working.\n' > welcome.llms.md
printf '# May notes\n' > release-notes/release-2026-05.llms.md
printf '{\n  "schema": 1,\n  "profile": "positron",\n  "version": "9999.01.0-1",\n  "generated": "2026-07-28T00:00:00Z",\n  "docsBaseUrl": "https://positron.posit.co/",\n  "fileCount": 4\n}\n' > bundle.json
zip -q -r ../positron-llms-latest.zip .
cd .. && shasum -a 256 positron-llms-latest.zip > positron-llms-latest.zip.sha256sum
python3 -m http.server 8099 --directory "$SCRATCH/docsfix" &
```

- [ ] **Step 8: Run the manual validation matrix**

Launch Positron with the override, one scenario at a time. Logs are in the Output panel, channel
**Extension Host** (desktop) or **Extension Host (Remote)** (Workbench/SSH), filtered on
`[positron-docs]`.

```bash
POSITRON_LLMS_DOCS_URL=http://127.0.0.1:8099 ./scripts/code.sh
```

Confirm each, and record pass/fail:

1. **Dev build resolves `latest-by-policy`.** A cache appears at
   `<userdata>/User/positron-docs/9999.01.0-1/` and the log shows the resolved URL and decision.
2. **`ai.enabled: false`** - set it, relaunch, confirm no request reaches the fixture server (watch
   its stdout) and `getLocalDocs()` returns `undefined`.
3. **Mid-session flip** - with `ai.enabled` false, delete the cache, then flip it true in Settings.
   The fetch fires with no reload.
4. **Lazy re-fetch and join** - delete the cache mid-session and call `getLocalDocs()` twice
   concurrently. One download, both callers get the result.
5. **Transition matrix** - drive 404, exact, fallback, 304, sidecar-404, and digest-mismatch by
   adding, removing, and corrupting objects under `$SCRATCH/docsfix`. Deleting a `.sha256sum` on
   purpose is how you exercise the sidecar-404 path.
6. **Two windows, cold cache** - open two windows at once against an empty cache directory. Confirm
   one usable bundle and no spurious failure from the prune race.
7. **Workbench** - profile resolves to `workbench`, and the cache lands on the **server's**
   filesystem where the remote extension host can read it. **This step has no automated backstop.**
8. **`POSITRON_DOCS_URL` set, bundle URL left at its default** - confirm the fetch still runs and
   local docs still land. The revision-4 skip rule is gone, and this is what proves it.

Stop the fixture server when done: `kill %1`.

- [ ] **Step 9: Push and open PR 2b**

```bash
git push
```

Open the PR with the `positron-pr-helper` skill. **PR 2b must not merge before PR 2a**, and note in
the body that the gating E2E (spec Rollout step 4) and the contract check (step 5) are deliberately
out of this plan's scope.

---

## Follow-ups this plan deliberately does not carry

Record these rather than leaving them implicit:

1. **Telemetry (owed, not optional).** A single counter distinguishing "served local docs" from "fell
   back to web", with the `resolution` value attached, in the release *after* this ships. Without it
   there is no way to tell whether exact-on-releases leaves release users on web docs because the
   manual docs publish runs late. Flagged twice during design and deferred twice.
2. **PR 2c, the gating `e2e-electron` test.** Needs a local HTTP server fixture (no e2e in the suite
   has one today) and an `extraEnv` worker option. `extraEnv` is already plumbed from
   `LaunchOptions` (`test/e2e/infra/code.ts:68`) down to the Electron spawn
   (`test/e2e/infra/electron.ts:95-106`); what is missing is the worker-option surface, which would
   touch `test/e2e/tests/_test.setup.ts` and `test/e2e/fixtures/test-setup/options.fixtures.ts`.
3. **The contract-check script and its weekly workflow.** `scripts/check-docs-bundle-contract.mts`
   plus a `schedule:` workflow modelled on `.github/workflows/slack-skipped-tests.yml`. Depends on
   the website PR having published at least once.
4. **Workbench E2E.** Deferred: needs `extraEnv` reaching the container, `docker exec` assertions,
   and a container-reachable fixture server. Manual step 7 covers it meanwhile.
5. **Schema-2 retirement owner.** When a schema bump happens, the dual-publish transition needs an
   owner for retiring the schema-1 keys. That belongs to the backlog item that introduces schema 2.
