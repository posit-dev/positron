# Plan: Notebook Output Cache Service

**Parent feature:** `plan-clean-notebook-metadata.md` (settings to strip outputs from .ipynb on save)
**Background research:** `plan-notebook-output-persistence.md` (persistence options analysis)

## 1. Overview

When users set `ipynb.output.saveOutputs: false`, cell outputs are stripped at
save time so the `.ipynb` file stays clean for version control. However, this
means outputs are lost when the notebook is closed and reopened. The notebook
output cache service persists outputs to a sidecar cache (outside the `.ipynb`
file) so they survive close/reopen cycles.

This follows the exact pattern established by `QuartoOutputCacheService`, which
solves the identical problem for Quarto inline outputs. We fork the pattern
rather than generalizing the Quarto service because:
- The Quarto cache uses Quarto-specific types (`ICellOutput` from
  `quartoExecutionTypes.ts`) while notebooks use VS Code's `IOutputDto` /
  `ICellOutput` from `notebookCommon.ts` -- they are different types
- The Quarto cache is tightly coupled to Quarto cell IDs (index-hash-label
  format) and the Quarto document model
- Coupling the two would add complexity without clear benefit

## 2. Key types

### VS Code notebook output types (from `notebookCommon.ts`)

```typescript
// The output item -- a single MIME type + data blob
interface IOutputItemDto {
    readonly mime: string;
    readonly data: VSBuffer;  // binary data, not string like Quarto's
}

// A single output (can contain multiple MIME representations)
interface IOutputDto {
    outputs: IOutputItemDto[];
    outputId: string;
    metadata?: Record<string, any>;
}

// Live model wrapping IOutputDto (from NotebookCellOutputTextModel)
interface ICellOutput {
    readonly versionId: number;
    outputs: IOutputItemDto[];
    metadata?: Record<string, any>;
    outputId: string;
    alternativeOutputId: string;
    asDto(): IOutputDto;
    // ... event handlers, mutation methods
}
```

### Quarto output types (from `quartoExecutionTypes.ts`)

```typescript
interface ICellOutputItem {
    readonly mime: string;
    readonly data: string;  // base64 or text -- NOT VSBuffer
}

interface ICellOutput {
    readonly outputId: string;
    readonly items: ICellOutputItem[];
    readonly webviewMetadata?: ICellOutputWebviewMetadata;
}
```

### Key differences

| Aspect | VS Code notebook | Quarto |
|--------|-----------------|--------|
| Data format | `VSBuffer` (binary) | `string` (base64/text) |
| Output items field | `.outputs` (on IOutputDto) | `.items` |
| Output metadata | `metadata?: Record<string, any>` | `webviewMetadata?: ICellOutputWebviewMetadata` |
| Cell identification | `handle: number` (runtime) + `metadata.id` (ipynb 4.5+) | `cellId: string` (index-hash-label) |
| Content hash | `getTextBufferHash()` on `NotebookCellTextModel` (SHA-1 of source) | Custom `contentHash` from Quarto document model |

The cache service must convert `VSBuffer` data to/from a serializable format
(base64 for binary, text for text MIMEs) when writing to/reading from disk.

## 3. Service architecture

### New interface: `INotebookOutputCacheService`

```typescript
// In a new file: src/vs/workbench/contrib/notebook/common/notebookOutputCacheService.ts

export const INotebookOutputCacheService =
    createDecorator<INotebookOutputCacheService>('notebookOutputCacheService');

export interface INotebookOutputCacheService {
    readonly _serviceBrand: undefined;

    /**
     * Load cached outputs for a notebook. Returns cell outputs keyed by
     * the cell's content hash. Returns undefined if no cache exists.
     */
    loadCache(notebookUri: URI): Promise<INotebookCachedDocument | undefined>;

    /**
     * Save all outputs for a cell. Replaces any previously cached outputs
     * for that cell. Marks the notebook as dirty for debounced write.
     *
     * @param notebookUri - the notebook URI
     * @param cellContentHash - SHA-1 of the cell's source text
     * @param cellIndex - the cell's current index (for disambiguation)
     * @param outputs - the cell's IOutputDto[] snapshot
     */
    saveCellOutputs(
        notebookUri: URI,
        cellContentHash: string,
        cellIndex: number,
        outputs: IOutputDto[],
    ): void;

    /**
     * Clear cached outputs for a single cell.
     */
    clearCellOutputs(notebookUri: URI, cellContentHash: string): void;

    /**
     * Clear entire cache for a notebook.
     */
    clearCache(notebookUri: URI): Promise<void>;

    /**
     * Force immediate flush to disk for a notebook.
     */
    flushCache(notebookUri: URI): Promise<void>;

    /**
     * Flush all pending caches (called on shutdown).
     */
    flushAll(): Promise<void>;

    /**
     * Run LRU cleanup to keep total cache size under the limit.
     */
    runCleanup(): Promise<void>;
}
```

### New types for cached data

```typescript
export interface INotebookCachedCell {
    /** SHA-1 of the cell's source text */
    readonly contentHash: string;
    /** Cell index at time of caching (for disambiguation) */
    readonly cellIndex: number;
    /** The cached outputs in IOutputDto-compatible format */
    readonly outputs: ISerializedOutputDto[];
}

export interface INotebookCachedDocument {
    /** Notebook URI string */
    readonly sourceUri: string;
    /** Timestamp of last update */
    readonly lastUpdated: number;
    /** Cached cells */
    readonly cells: INotebookCachedCell[];
}

/** Serialized form of IOutputDto where VSBuffer is replaced with base64 */
export interface ISerializedOutputItemDto {
    readonly mime: string;
    readonly data: string;  // base64-encoded for binary, raw text for text MIMEs
}

export interface ISerializedOutputDto {
    readonly outputs: ISerializedOutputItemDto[];
    readonly outputId: string;
    readonly metadata?: Record<string, any>;
}
```

### Implementation class: `NotebookOutputCacheService`

Lives in a new file:
`src/vs/workbench/contrib/notebook/browser/notebookOutputCacheService.ts`

Mirrors the structure of `QuartoOutputCacheService` with these parallel pieces:

| Quarto | Notebook |
|--------|----------|
| `DocumentCacheEntry` | `NotebookDocumentCacheEntry` |
| `CellCacheEntry` | `NotebookCellCacheEntry` |
| `IpynbNotebook` (cache file format) | `NotebookCacheFile` (similar JSON format) |
| `_cacheDir = 'quarto-inline-outputs'` | `_cacheDir = 'notebook-outputs'` |
| `IQuartoOutputCacheService` | `INotebookOutputCacheService` |

### Integration class: `NotebookOutputCacheContribution`

A workbench contribution registered via `registerWorkbenchContribution2`. This
is the glue layer that:
- Listens for notebook lifecycle events (open, close, cell execution)
- Captures outputs after execution completes
- Restores outputs when a notebook is opened
- Flushes on shutdown

This is analogous to how `QuartoOutputContribution` (an editor contribution)
integrates with `QuartoOutputCacheService`. For notebooks, we use a workbench
contribution instead because notebook lifecycle events come from
`INotebookService` / `INotebookExecutionStateService`, not from a specific
editor.

## 4. Cache key design

### Primary key: notebook URI -> SHA-1 hash for filename

Cache files are stored as `{sha1(notebookUri).substring(0, 16)}.json` in the
cache directory. This mirrors the Quarto approach.

### Cell key: content hash (SHA-1 of cell source text)

Each cell's outputs are keyed by the SHA-1 hash of the cell's source code. This
is the critical design decision that enables:

- **Stale detection**: if the cell source changes, the hash changes, and old
  cached outputs are no longer matched
- **Reorder tolerance**: if cells are reordered, the hash stays the same, so
  outputs are still matched correctly
- **Index disambiguation**: when multiple cells have identical source (rare but
  possible), we store the cell index alongside the hash to break ties

The content hash is available from `NotebookCellTextModel.getTextBufferHash()`
-- it's already computed and cached by the cell model.

### Why not cell `handle`?

Cell handles are runtime-only integers assigned when the notebook model is
created. They are not stable across close/reopen.

### Why not cell `metadata.id`?

The ipynb 4.5+ cell ID (`metadata.id`) is stable across saves and could work.
However:
- Not all notebooks have cell IDs (older nbformat versions)
- Using content hash provides automatic stale-output detection for free
- Consistent with the Quarto cache approach

We use content hash as the primary key with cell index as a disambiguation
tiebreaker.

## 5. Cache storage format

### File format: JSON (not ipynb)

Unlike the Quarto cache which uses ipynb format, we use a simpler JSON format.
The Quarto cache uses ipynb format because it makes cache files openable as
notebooks for debugging. For notebook outputs, this is less useful because:
- The outputs are already from notebooks, so the original .ipynb is the
  canonical viewer
- Notebook outputs can be large (images, data) and we need efficient
  serialization of `VSBuffer` data to base64
- A simpler format avoids maintaining compatibility with the full ipynb spec

### Cache file structure

```json
{
    "version": 1,
    "sourceUri": "file:///path/to/notebook.ipynb",
    "lastUpdated": 1713100000000,
    "cells": [
        {
            "contentHash": "a1b2c3d4e5f6...",
            "cellIndex": 0,
            "outputs": [
                {
                    "outputId": "uuid-1",
                    "outputs": [
                        {
                            "mime": "text/plain",
                            "data": "Hello, world!"
                        },
                        {
                            "mime": "image/png",
                            "data": "iVBORw0KGgo..."
                        }
                    ],
                    "metadata": {
                        "outputType": "execute_result"
                    }
                }
            ]
        }
    ]
}
```

### Data serialization

`VSBuffer` data must be converted to strings for JSON serialization:
- **Text MIME types** (`text/*`, `application/json`, `application/javascript`,
  `application/vnd.code.notebook.stdout`, etc.): decode to UTF-8 string
- **Binary MIME types** (`image/*`, `application/pdf`, etc.): encode to base64
  string

A helper function determines whether a MIME type is text or binary, using
the same logic as `textMimeTypes` in the ipynb extension.

On deserialization, the reverse: text strings are encoded to `VSBuffer`, base64
strings are decoded to `VSBuffer`.

### Storage location

`globalStorageHome/notebook-outputs/` -- same pattern as the Quarto cache.
Using global storage (not workspace storage) means outputs persist even if the
user opens the same file in a different workspace.

## 6. Lifecycle

### When to capture outputs

**After cell execution completes.** Listen to
`INotebookExecutionStateService.onDidChangeExecution` for
`ICellExecutionStateChangedEvent` where `changed === undefined` (execution
complete). At that point, read the cell's current outputs from the notebook
model and save them to the cache.

```
Cell execution completes
  -> onDidChangeExecution fires with changed === undefined
  -> Read cell.outputs from NotebookTextModel
  -> Compute contentHash via cell.getTextBufferHash()
  -> Call cacheService.saveCellOutputs(notebookUri, contentHash, cellIndex, outputs)
  -> In-memory cache is updated, debounced disk write is scheduled
```

### When to restore outputs

**When a notebook is opened with `ipynb.output.saveOutputs: false` and the
file has no outputs.** Listen to `INotebookService.onDidAddNotebookDocument`.
When a notebook is added:

1. Check if the `ipynb.output.saveOutputs` setting is `false` for this resource
2. If not, skip (outputs are in the file)
3. Load the cache for this notebook URI
4. For each cached cell, find the matching cell in the notebook model by
   comparing the cached `contentHash` against `cell.getTextBufferHash()`
5. If the hash matches, inject the cached outputs into the cell via
   `NotebookTextModel.applyEdits()` using `CellEditType.Output`
6. If the hash does not match, skip that cell (source changed, output is stale)

**Important**: restoring outputs should not mark the notebook as dirty. We need
to ensure that `applyEdits()` with output changes from cache restoration is
treated as a non-dirty operation. The simplest approach is to set outputs via
the model's internal API without going through undo/redo, or to immediately
reset the dirty flag after restoration.

### When to flush to disk

- **Debounced**: after each `saveCellOutputs()` call, schedule a debounced write
  (1 second, matching Quarto's `DEFAULT_CACHE_CONFIG.writeDebounceMs`)
- **On notebook close**: listen to `INotebookService.onWillRemoveNotebookDocument`
  and flush the cache for that notebook
- **On shutdown**: listen to `ILifecycleService.onWillShutdown` and call
  `flushAll()`

### When to evict

- **LRU cleanup**: run on startup (delayed, after 30 seconds to avoid impacting
  startup perf) and evict oldest cache files when total size exceeds the limit
  (100 MB, matching Quarto's default)
- **On cell re-execution**: when a cell starts executing, clear its cached
  outputs (they'll be replaced by new execution results)
- **On cache version mismatch**: when loading a cache file with an incompatible
  version, delete it

## 7. Integration points

### Events to listen to

| Event | Source | Purpose |
|-------|--------|---------|
| `onDidAddNotebookDocument` | `INotebookService` | Restore cached outputs when notebook opens |
| `onWillRemoveNotebookDocument` | `INotebookService` | Flush cache before notebook closes |
| `onDidChangeExecution` | `INotebookExecutionStateService` | Capture outputs after cell execution |
| `onWillShutdown` | `ILifecycleService` | Flush all caches before shutdown |
| `onDidRunWorkingCopyFileOperation` | `IWorkingCopyFileService` | Handle notebook rename/move |

### Services to inject

| Service | Purpose |
|---------|---------|
| `IFileService` | Read/write cache files |
| `ILogService` | Debug logging |
| `ILifecycleService` | Shutdown hook |
| `IUserDataProfilesService` | Get `globalStorageHome` for cache directory |
| `IWorkingCopyFileService` | File rename tracking |
| `INotebookService` | Notebook open/close events, get notebook model |
| `INotebookExecutionStateService` | Cell execution completion events |
| `IConfigurationService` | Read `ipynb.output.saveOutputs` setting |

### Where to hook into notebook open/close

The `NotebookOutputCacheContribution` workbench contribution will:

1. On activation, subscribe to `INotebookService.onDidAddNotebookDocument`
2. When a notebook is added, check the setting and restore outputs if needed
3. Subscribe to `INotebookService.onWillRemoveNotebookDocument` to flush
4. Subscribe to `INotebookExecutionStateService.onDidChangeExecution` to
   capture outputs after execution

### Restoring outputs into the model

To inject cached outputs into a newly opened notebook, use
`NotebookTextModel.applyEdits()` with `ICellOutputEdit` operations:

```typescript
const edits: ICellEditOperation[] = [];
for (const cachedCell of cachedDoc.cells) {
    const cellIndex = findCellByContentHash(model, cachedCell.contentHash, cachedCell.cellIndex);
    if (cellIndex !== -1) {
        edits.push({
            editType: CellEditType.Output,
            index: cellIndex,
            outputs: deserializeOutputs(cachedCell.outputs),
        });
    }
}

if (edits.length > 0) {
    model.applyEdits(edits, true, undefined, () => undefined, undefined, false);
}
```

The `computeUndoRedo: false` parameter (last arg) ensures the output restoration
does not create an undo entry and does not mark the notebook as modified.

## 8. Content hash validation

### How it works

1. When saving outputs to cache, compute `cell.getTextBufferHash()` and store
   it alongside the outputs
2. When restoring, compute the current cell's hash and compare:
   - Match -> restore outputs
   - Mismatch -> skip (cell source changed, cached output is stale)

### Edge case: hash collision

Two cells with identical source code will have the same content hash. We use
the cell index as a tiebreaker: when multiple cells share a hash, prefer the
one whose cached index matches the current index. If indexes also collide
(extremely unlikely), restore to the first match.

### Performance

`getTextBufferHash()` is already cached on the cell model (invalidated only
when content changes). No additional hashing cost.

## 9. Edge cases

### Cell reordering

Content hash stays the same when a cell moves. The `cellIndex` stored in the
cache may no longer match, but the hash-based lookup will still find the cell.
When restoring, we iterate over cached cells and find each one by hash,
preferring the cached index for disambiguation.

### Cell deletion

If a cell is deleted, its hash no longer exists in the notebook model. The
cached output for that hash is simply skipped during restoration. It will
eventually be evicted by LRU cleanup or overwritten when the cache is next
flushed.

### Cell insertion

New cells have no cached outputs. Existing cells' hashes are unchanged, so
their cached outputs are still valid and will be restored.

### Notebook rename/move

Listen to `IWorkingCopyFileService.onDidRunWorkingCopyFileOperation` for MOVE
operations. When a notebook is renamed:
1. Update the in-memory cache key from old URI to new URI
2. Delete the old cache file
3. Mark the new URI as dirty to trigger a write with the new filename hash

This mirrors the Quarto cache's `_handleFileRename()` method.

### Multiple notebooks with same name

Cache files are keyed by the full URI hash (not just the filename), so
`project-a/analysis.ipynb` and `project-b/analysis.ipynb` get different cache
files.

### Large outputs

Images, HTML widgets, and data frames can produce large outputs. Mitigations:
- The 100 MB total cache size limit prevents unbounded growth
- Individual outputs are not truncated -- if the user produced a large output,
  it should be cached faithfully. The LRU eviction will clean up old cache
  files to make room.
- Consider adding an optional per-notebook or per-cell size limit in the
  future if needed.

### Cache corruption

On `loadCache()`, validate the JSON structure and version number. If either is
invalid, delete the cache file and return undefined (no cached outputs). This
matches the Quarto approach. Wrap the entire load in a try/catch.

### Concurrent writes

Use the same pattern as Quarto: track pending writes per notebook URI in a
`Map<string, Promise<void>>`. New writes wait for any in-flight write to
complete before starting.

### Hot exit interaction

The cache service is independent of hot exit. Hot exit backups are handled by
the existing working copy infrastructure. The cache is a separate, additive
mechanism. Even if hot exit is disabled, the cache will restore outputs on
reopen.

The parent feature plan must also fix the save-vs-backup stripping problem
(see `plan-notebook-output-persistence.md` section 1) so that hot exit backups
retain outputs. The cache service provides the close/reopen persistence that
hot exit cannot.

## 10. Settings

### New setting: `ipynb.output.cacheOutputsLocally`

```jsonc
"ipynb.output.cacheOutputsLocally": {
    "type": "boolean",
    "scope": "resource",
    "default": true,
    "markdownDescription": "Cache notebook cell outputs locally so they persist when the notebook is closed and reopened. Only applies when `#ipynb.output.saveOutputs#` is disabled."
}
```

**Why default `true`?** When the user has opted into `saveOutputs: false`, the
most natural expectation is that outputs are still available when reopening.
Caching should be opt-out for the rare user who truly wants no output
persistence at all.

**Why resource scope?** Same as the other `ipynb.output.*` settings -- allows
per-project configuration.

**Behavior:**
- When `saveOutputs: true` (default): cache service is inactive. Outputs are
  in the file.
- When `saveOutputs: false` and `cacheOutputsLocally: true`: cache service is
  active. Outputs are stripped from the file but cached locally.
- When `saveOutputs: false` and `cacheOutputsLocally: false`: no caching.
  Outputs are truly ephemeral.

### Future: cache size limit setting

```jsonc
"ipynb.output.maxCacheSize": {
    "type": "number",
    "default": 104857600,
    "description": "Maximum total size of the notebook output cache in bytes. Oldest entries are evicted when this limit is exceeded."
}
```

This can be deferred to a follow-up -- the 100 MB default is reasonable for
most users.

## 11. Key files to create/modify

### New files

| File | Purpose |
|------|---------|
| `src/vs/workbench/contrib/notebook/common/notebookOutputCacheService.ts` | `INotebookOutputCacheService` interface, types, and `createDecorator` |
| `src/vs/workbench/contrib/notebook/browser/notebookOutputCacheService.ts` | `NotebookOutputCacheService` implementation (in-memory + disk cache) |
| `src/vs/workbench/contrib/notebook/browser/notebookOutputCacheContribution.ts` | `NotebookOutputCacheContribution` workbench contribution (lifecycle integration) |
| `src/vs/workbench/contrib/notebook/test/browser/notebookOutputCacheService.test.ts` | Unit tests |

### Files to modify

| File | Change |
|------|--------|
| `src/vs/workbench/contrib/notebook/browser/notebook.contribution.ts` | Register `NotebookOutputCacheService` singleton and `NotebookOutputCacheContribution` workbench contribution |
| `extensions/ipynb/package.json` | Add `ipynb.output.cacheOutputsLocally` setting |
| `extensions/ipynb/package.nls.json` | NLS string for the new setting |

### Files NOT to modify

- `notebookCommon.ts` -- no changes to core types
- `notebookTextModel.ts` -- we use existing `applyEdits()` API
- `notebookCellTextModel.ts` -- we use existing `getTextBufferHash()`
- `quartoOutputCacheService.ts` -- independent service, no coupling

## 12. Trade-offs and open questions

### Should the cache be workspace-scoped or global?

**Decision: global** (matching Quarto). A user who opens the same notebook from
different workspaces should still see cached outputs. The URI hash provides
uniqueness.

### Should we cache ALL outputs or only when `saveOutputs: false`?

**Decision: only when `saveOutputs: false`** (and `cacheOutputsLocally: true`).
When outputs are saved to the file, caching is redundant. This keeps the cache
small and avoids confusing double-storage.

**Open question**: should we also cache when `saveOutputs: true` to enable
faster reopening? This would be a different use case (performance optimization)
and can be considered later.

### Should restoring outputs mark the notebook dirty?

**Decision: no.** Using `applyEdits(..., computeUndoRedo: false)` avoids
creating an undo entry and should not trigger a dirty state. Verify during
implementation that this is the case; if not, manually clear the dirty flag
after restoration.

### Should we filter out non-cacheable MIME types?

The Quarto cache filters out `application/vnd.positron.dataExplorer+json`
because data explorer requires a live runtime connection. We should do the same:
- `application/vnd.positron.dataExplorer+json` -- strip (data explorer needs
  live comm)
- IPyWidget state -- strip if present (widgets need live kernel)
- All other MIMEs -- cache faithfully

### What happens if the user toggles `saveOutputs` back to `true`?

The cache becomes dormant. Existing cache files are not deleted (they'll be
evicted by LRU over time). If the user toggles back to `false`, the cache is
still there and outputs are restored.

### What about notebook trust?

VS Code has a notebook trust model where untrusted notebooks have restricted
output rendering. Cached outputs should inherit the trust state of the notebook
they belong to. Since we inject outputs into the existing notebook model (which
already has a trust state), this should work automatically.

### Race condition: execution completes while cache is loading?

During notebook open, we restore cached outputs. If the user immediately
executes a cell, the execution output should replace the cached output. The
execution completion handler calls `saveCellOutputs()` which replaces the
in-memory entry. Since execution completion always fires after the outputs are
already on the model, the cache will be updated with the new outputs.

### How do we handle the case where outputs were stripped from the file
    but the user also has `cacheOutputsLocally: false`?

In this case, the notebook opens with no outputs, and no cache exists. The user
must re-execute cells. This is the expected behavior for users who genuinely
want no output persistence (matching `nbstripout` behavior).
