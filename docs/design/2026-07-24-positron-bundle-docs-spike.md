# Bundling Positron docs on disk

Date: 2026-07-24

Status: Analysis / design for team discussion

Author: Marie Idleman (with Claude)

## Goal

Let Positron's AI assistant read the product documentation from disk instead of fetching it from `https://positron.posit.co`. Reading from disk:

- cuts token usage (no full HTML pages pulled into context),
- removes per-call WebFetch approval prompts,
- works offline once the docs are present.

The docs must be available at (or shortly after) install time, ideally matching the running build's version. The solution should be low-maintenance.

Both **Positron Desktop and Posit Workbench** are in scope. The aim is a single mechanism that serves both products so Workbench does not need separate handling.

## TL;DR

Most of the hard part already exists. The docs site (`posit-dev/positron-website`) is a Quarto project that already emits LLM-optimized Markdown and already publishes versioned docs bundles to the CDN. What is missing is an assistant-readable copy on disk in the app itself:

1. a **slim, LLM-only bundle** (the site publishes a 67MB full bundle; the assistant needs ~150KB of it),
2. a way to get that bundle **onto disk** in the app (Desktop and web/server), and
3. a **read path** so the assistant reads local Markdown instead of WebFetch. Note the index (`llms.txt`) links out to `positron.posit.co` URLs, so this also means translating those to on-disk paths.

This doc lays out three approaches (A/B/C) for getting the docs on disk, with trade-offs.

## Current State

### The docs site already emits LLM Markdown

`posit-dev/positron-website` is a Quarto website. Its `_quarto.yml` sets `website: llms-txt: true`, which is the [llmstxt.org](https://llmstxt.org) standard. For every page Quarto renders two outputs:

- `welcome.html` - the full web page (nav, CSS, JS, images, embedded video).
- `welcome.llms.md` - the same content as clean Markdown, stripped of site chrome. This is what an LLM wants.

Plus a top-level `llms.txt` - a Markdown index linking every `.llms.md` page.

The site also builds two product profiles from the same sources: `_quarto-positron.yml` (public Positron) and `_quarto-workbench.yml` (Workbench), selected via `QUARTO_PROFILE`.

### Versioned docs bundles are already built and published

`positron-website/.github/workflows/release-docs-bundles.yml` already:

- renders both the `positron` and `workbench` profiles,
- zips each rendered site into `positron-docs-<version>.zip` and `positron-workbench-docs-<version>.zip`,
- publishes them as GitHub releases on the website repo, and
- uploads them to S3, served via CDN under `https://cdn.posit.co/positron/<channel>/docs/`.

These are live today. Confirmed reachable (HTTP 200):

```
https://cdn.posit.co/positron/releases/docs/positron-docs-2026.05.0-179.zip
https://cdn.posit.co/positron/releases/docs/positron-workbench-docs-2026.05.0-179.zip
```

### The chicken-and-egg constraint

The binaries are built from the release branch and pushed out first (wiki step 3). The versioned docs bundle is published later, manually, at wiki step 7 - after release notes are finalized and the website is updated.

**Consequence:** the version-X docs bundle does not exist when the version-X binary is built. Docs baked into the installer can never be exact-version for that release; exact-version docs are only obtainable after the build, from the CDN.

## Proposed Solution

The solution has three steps. Steps 1 and 3 are the same regardless of which approach we choose; **Step 2 is the only place the A/B/C decision lives**, so Steps 1 and 3 can proceed while that decision is still open.

### Step 1: A Slim Bundle

The published bundle is **67MB** because it is the entire rendered site: 99 PNGs, MP4/MOV videos, fonts, HTML, CSS, JS. The assistant can use none of that. The LLM-relevant content is only `llms.txt` + all `*.llms.md`:

```
~655KB uncompressed across 90 files  (~150KB zipped)
```

A slim bundle is exactly that subset - plain Markdown, no chrome:

```
positron-llms-2026.05.0-179/
  llms.txt                     # index; the model reads this first
  welcome.llms.md
  data-explorer.llms.md
  assistant-chat.llms.md
  release-notes/release-2026-05.llms.md
  ... (90 files)
```

**How to produce it.** `release-docs-bundles.yml` already renders these files into `_site` / `_site-workbench` next to the HTML. Add one `zip` step that globs `llms.txt` + `**/*.llms.md` (producing `positron-llms-<version>.zip` and a workbench variant) and upload it alongside the existing bundles to the same CDN `docs/` prefix. No new infrastructure - it reuses the existing render, S3 upload, and CloudFront invalidation. Estimated change: ~5-10 lines, one new CDN object per profile per release.

This step can also rewrite `llms.txt` to relative paths so the on-disk copy is already local-relative (see Step 3). Shipping ~150KB instead of 67MB is the single biggest win and is a prerequisite for every approach in Step 2.

### Step 2: Getting It on Disk

This is the only step where the approaches differ - three ways to get the Step 1 bundle onto the user's machine. The choice hinges on one trade-off: exact-version-matched docs (which require a download) versus guaranteed offline and day-one availability (which requires baking a snapshot that can't be exact).

| | A. Runtime download + cache | B. Build-time bake | C. Bake + download (A + B) |
|---|---|---|---|
| How docs reach disk | App downloads slim bundle from CDN, unzips to app-data cache | Slim snapshot baked into app `resources/` at build time | Baked snapshot **and** runtime download of the CDN bundle |
| Exact-version match | Yes (downloads its own version) | No (chicken-egg) | Snapshot is not exact; converges to exact after download |
| Works offline (no network) | No | Yes | Yes (snapshot), downloads when reachable |
| Day-one availability | After first successful download | Immediate | Immediate |
| Maintenance | Low | Low | Medium (two code paths) |
| Mirrors Workbench model | Yes (docs_url style) | Partial | Yes (superset) |

#### A. Runtime download + cache

Ship no docs in the installer. The app downloads `positron-llms-<ownVersion>.zip` from the CDN, unzips to a writable app-data cache, and the assistant reads from there. Subsequent reads are offline and token-free.

Two candidate triggers for the download:

- **On app launch, if the cache is missing/wrong version** - check on startup and fetch in the background so docs are ready before the user asks. Predictable, but spends network on launches where the assistant is never used.
- **On first need** - fetch lazily the first time the assistant actually needs docs. No wasted network, but the first docs question pays the download latency (or falls back until the download lands).

These are not exclusive; a reasonable default is a launch-time check with a lazy fetch as backstop. This trigger choice also applies to C's download step.

Mechanics: the app knows its own version, so it builds the CDN URL directly; the cache is versioned so a stale copy is replaced on the next launch/update.

- Pros: exact-version by construction; simplest; smallest installer; closest to how Workbench already resolves `docs_url`.
- Cons: needs network at least once; **no on-disk fallback**. A machine that is never online gets no local docs at all - the assistant degrades to its current behavior (fetch from `positron.posit.co`), which also fails offline, so that user ends up with no doc access at all. There is also a small window right after a release where the exact-version bundle is not yet published (step 7 is manual), which needs a retry/fallback policy.

#### B. Build-time bake

Ship the slim docs in the app at build time and read them at runtime via the `positronHelp` precedent: put the folder under `src/vs/workbench/contrib/<contrib>/browser/resources/docs/**` (contrib TBD - `positronAssistant` or a new `positronDocs`), whitelist it in the `vscodeResources` glob in `build/gulpfile.vscode.ts`, and read files with `FileAccess.asFileUri` + `IFileService.readFile`. Populate the folder during the build from website `main` (pull the Step 1 bundle from the CDN, or render Quarto in the build). No network needed at runtime, ever.

- Pros: works fully offline; available on day one; no runtime download code.
- Cons: **cannot be exact-version** (chicken-egg); the baked snapshot is from website `main` at build time and can lag **any** doc touched during the release window, not just release notes. Feature docs are often finalized after the build (release-process step 5), so the snapshot can be missing the guide page for a feature that ships in the very same build - the gap lands on exactly the new features users are most likely to ask about. Also: every build re-bakes docs even when they have not changed, and it couples the app build to the docs site state at build time.

#### C. Bake + download (A + B)

This is just A and B together: bake the slim snapshot (B) for immediate/offline availability, then download the exact-version slim bundle from the CDN when reachable (A). The read side prefers the downloaded cache copy and falls back to the baked snapshot.

- Pros: day-one and offline coverage from the snapshot; converges to exact-version via download; is a clean superset of both A and B and of the Workbench model.
- Cons: two code paths (bake + download) and a resolution rule between them; slightly more to test.

### Step 3: The Read Path

This step is largely on the assistant side (`posit-dev/assistant`); it is included here for completeness. The read path already exists as the `positron-ide` skill, which fetches from the web today. The work is to point it at local files:

- **Advertise an on-disk docs path from Positron.** Extend `IPositronDocsService` (or add a companion resolver) to answer "where are the docs on disk," preferring the downloaded cache and falling back to the baked snapshot, and surface that path to the assistant extension (e.g. via an API/command/env the skill can query - the existing `POSITRON_DOCS_URL` override is the precedent). Keep the existing URL behavior for web links.
- **Update the `positron-ide` skill** (posit-dev/assistant) to read `llms.txt` + the relevant `.llms.md` from that local path when present, falling back to the live site when it is not. This is the change that replaces WebFetch for docs.

No new core assistant tool is required; the existing skill + a path handshake is enough.

**Index URL translation.** `llms.txt` links out to absolute `positron.posit.co` URLs (e.g. `https://positron.posit.co/welcome.llms.md`), so reading it locally means mapping those to on-disk file paths. Cleanest is to rewrite `llms.txt` to relative paths in the slim-bundle build step (Step 1), so what ships on disk is already local-relative; the alternative is to strip/replace the base URL at read time. Only `llms.txt` needs this - the `.llms.md` pages carry no site links.

## Workbench carryover

Workbench runs Positron as a web/server build, so if the docs are bundled in the app itself (desktop **and** web/server), a Workbench user reads them from the same in-app on-disk location as a Desktop user - no auth, no cross-pod problem, and no need for the separate Workbench-side work.

Caveat: this requires the bundle to ship in the **web/server** build, not just the desktop installer. The `vscodeResources` glob in `build/gulpfile.vscode.ts` covers the desktop package; the REH server build defines its own `serverResources` in `build/gulpfile.reh.ts`, and the web client has a third set of resource globs in `build/gulpfile.vscode.web.ts`. All three are defined independently, so confirming the docs folder is included in each is a prerequisite for the Workbench carryover.
