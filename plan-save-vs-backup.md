# Plan: Distinguishing Save from Backup in Notebook Serialization

## Problem

We want to strip outputs/execution info from `.ipynb` files on save (for clean
VCS diffs) but NOT on backup (so outputs survive window reload). The extension
API `serializeNotebook()` is called for both operations with the same
signature -- it receives `(data: NotebookData, token: CancellationToken)` and
has no way to know whether the result is destined for disk or for a hot-exit
backup.

## Call Chain Analysis

### Path A: Save (standard, non-remote)

```
StoredFileWorkingCopy.save(options)                     -- storedFileWorkingCopy.ts:841
  doSave(options)                                       -- storedFileWorkingCopy.ts:869
    doSaveSequential(versionId, options, ...)            -- storedFileWorkingCopy.ts:952

    1. Run save participants (onWillSaveNotebookDocument fires here)
       workingCopyFileService.runSaveParticipants(...)   -- storedFileWorkingCopy.ts:988

    2. Check: model.save exists?  (only if remoteSaving enabled)
       YES -> model.save(writeFileOptions, token)        -- storedFileWorkingCopy.ts:1048-1050
              (see Path A2 below)
       NO  -> model.snapshot(SnapshotContext.Save, token) -- storedFileWorkingCopy.ts:1064
              (see Path A1 below)

    3. Write snapshot to disk via fileService.writeFile()  -- storedFileWorkingCopy.ts:1079-1083
```

#### Path A1: Standard snapshot-based save

```
NotebookFileWorkingCopyModel.snapshot(SnapshotContext.Save, token) -- notebookEditorModel.ts:301
  notebookService.createNotebookTextDocumentSnapshot(uri, SnapshotContext.Save, token)
                                                        -- notebookServiceImpl.ts:960
    model.createSnapshot({ context: Save, outputSizeLimit, transientOptions: serializer.options })
                                                        -- notebookServiceImpl.ts:975
      NotebookTextModel.createSnapshot(options)          -- notebookTextModel.ts:475
        Filters metadata via transientOptions
        Filters outputs via transientOptions.transientOutputs  -- notebookTextModel.ts:504
    serializer.notebookToData(data)                      -- notebookServiceImpl.ts:981
      -> mainThread proxy -> $notebookToData             -- mainThreadNotebook.ts:73-75
        -> extHostNotebook.$notebookToData               -- extHostNotebook.ts:315
          -> serializer.serializeNotebook(data, token)   -- extHostNotebook.ts:320
            -> NotebookSerializerBase.serializeNotebook() -- notebookSerializer.ts:79
              -> serializeNotebookToString(data)          -- notebookSerializer.ts:84
```

#### Path A2: Optimized remote save (save delegate)

When `NotebookSetting.remoteSaving` is true, `NotebookFileWorkingCopyModel`
sets `this.save` to a function that bypasses snapshot entirely:

```
NotebookFileWorkingCopyModel.save(writeFileOptions, token) -- notebookEditorModel.ts:244
  serializer.save(uri, versionId, options, token)          -- serializer from notebookService
    -> mainThread proxy -> $saveNotebook                    -- mainThreadNotebook.ts:82-83
      -> extHostNotebook.$saveNotebook(handle, uri, ...)   -- extHostNotebook.ts:324
        Builds NotebookData from document.apiNotebook      -- extHostNotebook.ts:347-366
        Filters outputs via serializer.options.transientOutputs -- extHostNotebook.ts:359
        serializer.serializer.serializeNotebook(data, token) -- extHostNotebook.ts:374
        extHostFileSystem.writeFile(uri, bytes)             -- extHostNotebook.ts:381
```

### Path B: Backup (hot-exit)

```
StoredFileWorkingCopy.backup(token)                      -- storedFileWorkingCopy.ts:805
  model.snapshot(SnapshotContext.Backup, token)           -- storedFileWorkingCopy.ts:822
    -> NotebookFileWorkingCopyModel.snapshot(SnapshotContext.Backup, token)
                                                         -- notebookEditorModel.ts:301
      notebookService.createNotebookTextDocumentSnapshot(uri, SnapshotContext.Backup, token)
                                                         -- notebookServiceImpl.ts:960
        model.createSnapshot({ context: Backup, outputSizeLimit, transientOptions: serializer.options })
                                                         -- notebookServiceImpl.ts:975
          (Same path as A1 from here, but with context=Backup)
          The Backup context only affects the output SIZE LIMIT check
                                                         -- notebookTextModel.ts:493-501
          Output inclusion still governed by transientOptions.transientOutputs
        serializer.notebookToData(data)                  -- notebookServiceImpl.ts:981
          -> ... same chain as A1 -> serializeNotebook()
```

### Key Insight

Both save and backup go through the same `createNotebookTextDocumentSnapshot`
method. The `SnapshotContext` IS threaded through to `createSnapshot()` but it
is ONLY used for the backup output size limit check (line 493). It is NOT
passed to `notebookToData()` / `serializeNotebook()`.

The serializer never sees the context. By the time `serializeNotebook()` is
called in the extension host, the `NotebookData` has already been constructed
and the context has been discarded.

## Options

### Option 1: Flag on serializer instance (`_isSaving`)

Set a flag on the serializer before save, clear it after.

**Mechanism:** In `ipynbMain.ts`, register an `onWillSaveNotebookDocument`
listener that sets `serializer._isSaving = true`. In `serializeNotebook()`,
check the flag and strip outputs if true. Clear the flag after serialization.

**Upstream changes:** None.

**Positron-only changes:** `notebookSerializer.ts`, `ipynbMain.ts`.

**Race condition risk:** HIGH. `backup()` can be called at any time,
including while a save is in progress. The flag would be set during the save
participant phase, but `snapshot()` for the actual save happens AFTER
participants finish. Meanwhile, a backup could call `snapshot()` while the flag
is set. The backup would then strip outputs. Additionally, the worker-based
serializer (`notebookSerializer.node.ts`) posts data to a worker thread -- the
flag would be checked on the main thread during `serializeNotebook()` but
multiple serializations could be in flight.

**Complexity:** Low implementation, high correctness risk.

**Verdict:** Fragile. Not recommended.

### Option 2: `onWillSaveNotebookDocument` to mutate data before save

Use the `onWillSaveNotebookDocument` save participant to modify the
`NotebookData` BEFORE serialization happens.

**Mechanism:** Register a save participant that applies workspace edits to
strip outputs/execution info from the notebook cells.

**Problem:** Save participants run BEFORE `snapshot()`. They modify the
in-memory `NotebookTextModel`. If we strip outputs via workspace edits in a
save participant, the outputs are removed from the live model -- the user would
see them disappear from the UI. We would need to restore them after save, which
is itself racey and complex.

**Also:** The save participant fires for explicit saves and auto-saves, but NOT
for backups. This is confirmed by the code -- `runSaveParticipants` is called
inside `doSaveSequential` (storedFileWorkingCopy.ts:961-988), which is only
invoked from `doSave`, not from `backup`.

**Upstream changes:** None.

**Positron-only changes:** `ipynbMain.ts` (new save participant registration).

**Race condition risk:** HIGH. Mutating and restoring the live model is
inherently racey -- a backup could snapshot between the strip and restore.

**Complexity:** High.

**Verdict:** Wrong approach -- mutating the live model is not viable.

### Option 3: Override `snapshot()` in `NotebookFileWorkingCopyModel` to pass context-dependent transientOptions

The `snapshot()` method in `NotebookFileWorkingCopyModel` already receives
`SnapshotContext`. It calls `createNotebookTextDocumentSnapshot(uri, context,
token)`. That method passes `serializer.options` as `transientOptions`. We
could intercept and override the transient options for `SnapshotContext.Save` to
set `transientOutputs: true` (which means "outputs are transient, don't include
them").

**Mechanism:** In `createNotebookTextDocumentSnapshot`
(notebookServiceImpl.ts:960), the `transientOptions` are taken from
`serializer.options` and passed to `createSnapshot()`. On line 504 of
notebookTextModel.ts:
```typescript
cellData.outputs = !transientOptions.transientOutputs ? cell.outputs : [];
```
If `transientOutputs` is true, outputs are excluded from the snapshot.

We would modify `createNotebookTextDocumentSnapshot` to, when `context ===
SnapshotContext.Save`, merge in additional transient options based on user
settings. For example, if the user has configured "strip outputs on save", we
would set `transientOutputs: true` only for the save snapshot.

The data that reaches `serializeNotebook()` would already have outputs stripped.
Backups would continue to use the original `serializer.options` (where
`transientOutputs: false`).

**Upstream changes:** `notebookServiceImpl.ts` -- modify
`createNotebookTextDocumentSnapshot` to conditionally override transientOptions
based on context. This is an upstream file.

**Positron-only changes:** The change in `notebookServiceImpl.ts` would be
wrapped in Positron markers. We would also need the settings definitions in
`extensions/ipynb/package.json` and possibly a way to read those settings from
the main thread side (the `IConfigurationService` is available in
`notebookServiceImpl.ts`).

**Race condition risk:** NONE. The context is passed per-call. Save and backup
can happen concurrently with different contexts, and each will get the correct
transientOptions. No mutable shared state.

**Complexity:** Medium. Requires understanding the transient options mechanism.

**Merge conflict risk:** MEDIUM. We modify `createNotebookTextDocumentSnapshot`
which is an upstream method. The change is small (a few lines of conditional
logic), but any upstream changes to this method could cause conflicts.

**Limitation:** This strips outputs at the `NotebookData` level -- before the
data reaches `serializeNotebook()`. It does NOT handle stripping
`execution_count` or `kernelspec` metadata, which are serialized in
`serializeNotebookToString()`. For those, we would still need logic in the
serializer itself. However, since the data arrives without outputs, the
serializer could check for their absence as a signal -- or we could pass
additional metadata through `NotebookData.metadata` as a flag.

### Option 4: Pass `SnapshotContext` through the serializer pipeline to `serializeNotebook()`

Thread the `SnapshotContext` all the way from `createNotebookTextDocumentSnapshot`
through `notebookToData` to the extension host `serializeNotebook()`.

**Mechanism:** Add an optional `context` parameter to:
1. `INotebookSerializer.notebookToData(data, context?)` (notebookService.ts:36)
2. `MainThreadNotebook.$notebookToData(handle, data, context?)` (extHost.protocol.ts)
3. `ExtHostNotebook.$notebookToData(handle, data, context?)` (extHostNotebook.ts)
4. `NotebookSerializer.serializeNotebook(data, token, context?)` (vscode.d.ts)

The serializer could then check `context === Save` and strip outputs.

**Upstream changes:** EXTENSIVE. Modifies:
- The `vscode.d.ts` API surface (NotebookSerializer interface)
- The IPC protocol (extHost.protocol.ts)
- Multiple mainThread/extHost files
- The internal INotebookSerializer interface

**Positron-only changes:** The serializer in `extensions/ipynb/` would use the
context parameter.

**Race condition risk:** NONE. Context is per-call.

**Complexity:** HIGH. Touches many upstream files, changes a public API.

**Merge conflict risk:** HIGH. Changes to the VS Code extension API and IPC
protocol are upstream-heavy.

**Verdict:** Correct in principle, but the upstream cost is prohibitive.

### Option 5: Override at `NotebookFileWorkingCopyModel.snapshot()` level

Override `snapshot()` in `NotebookFileWorkingCopyModel` to call a different
serialization path for save vs backup.

**Mechanism:** Currently `snapshot()` is:
```typescript
async snapshot(context: SnapshotContext, token: CancellationToken): Promise<VSBufferReadableStream> {
    return this._notebookService.createNotebookTextDocumentSnapshot(this._notebookModel.uri, context, token);
}
```

We could override this to:
- For `SnapshotContext.Backup`: call the normal path (unchanged)
- For `SnapshotContext.Save`: call a modified path that applies output
  stripping settings

This could be done by creating a Positron subclass of
`NotebookFileWorkingCopyModel`, or by modifying the method directly with
Positron markers.

**Upstream changes:** `notebookEditorModel.ts` -- modify `snapshot()` method.
This file is upstream but already has Positron modifications unlikely.

**Positron-only changes:** Small change in `snapshot()` method, plus settings.

**Race condition risk:** NONE. Context is per-call.

**Complexity:** Medium.

**Merge conflict risk:** LOW-MEDIUM. The `snapshot()` method is small and
unlikely to change upstream.

### Option 6: Use `onWillSaveNotebookDocument` to set a marker on NotebookData metadata

Use the save participant to set a marker in the notebook metadata that the
serializer can read, without modifying the live model's real data.

**Mechanism:**
1. In `onWillSaveNotebookDocument`, set a transient metadata flag like
   `_positron_strip_outputs: true` via a workspace edit.
2. In `serializeNotebook()`, check for this flag, strip outputs, and remove the
   flag from the serialized output.
3. The flag is set as `transientDocumentMetadata`, so it does NOT trigger a
   content change and is NOT included in backups (since
   `transientDocumentMetadata` entries are filtered out in `createSnapshot()`).

**Problem:** The `transientDocumentMetadata` mechanism filters metadata keys
from the snapshot data. If we set a metadata key as transient, it is stripped
from BOTH save and backup snapshots. We cannot conditionally make it transient.
Also, workspace edits applied in a save participant modify the live model and
would be visible/undoable.

**Verdict:** Does not work as described. The transient metadata mechanism does
not support conditional filtering by context.

### Option 7: Modify `createNotebookTextDocumentSnapshot` to apply output settings based on config + context (RECOMMENDED)

A refined version of Option 3. Instead of modifying the extension serializer,
handle everything inside `createNotebookTextDocumentSnapshot` by building
context-dependent `transientOptions`.

**Mechanism:**

In `notebookServiceImpl.ts`, modify `createNotebookTextDocumentSnapshot`:

```typescript
async createNotebookTextDocumentSnapshot(uri: URI, context: SnapshotContext, token: CancellationToken): Promise<VSBufferReadableStream> {
    const model = this.getNotebookTextModel(uri);
    if (!model) {
        throw new Error(`notebook for ${uri} doesn't exist`);
    }

    const info = await this.withNotebookDataProvider(model.viewType);
    if (!(info instanceof SimpleNotebookProviderInfo)) {
        throw new Error('CANNOT open file notebook with this provider');
    }

    const serializer = info.serializer;
    const outputSizeLimit = this._configurationService.getValue<number>(NotebookSetting.outputBackupSizeLimit) * 1024;

    // --- Start Positron ---
    let transientOptions = serializer.options;
    if (context === SnapshotContext.Save) {
        const stripOutputs = !this._configurationService.getValue<boolean>('ipynb.output.saveOutputs');
        if (stripOutputs) {
            transientOptions = {
                ...transientOptions,
                transientOutputs: true,
            };
        }
    }
    // --- End Positron ---

    const data: NotebookData = model.createSnapshot({
        context,
        outputSizeLimit,
        transientOptions,  // was: serializer.options
    });

    // ... rest unchanged
}
```

**What this handles:**
- Outputs: Stripped via `transientOutputs: true` in the snapshot. The
  serializer receives `NotebookData` with empty output arrays, so
  `serializeNotebookToString` writes `"outputs": []`. This is correct.
- Backups: Use the original `serializer.options` (where `transientOutputs:
  false`), so outputs are preserved in backup snapshots.

**What this does NOT handle:**
- `execution_count`: This is serialized in `createCodeCellFromNotebookCell()`
  in `serializers.ts` from `cell.executionSummary?.executionOrder`. The
  execution summary is part of `NotebookCellData.executionSummary`, which is
  included in the snapshot regardless of transient options. Stripping this
  requires changes in the serializer.
- `kernelspec` / `language_info` metadata: These are notebook-level metadata
  written in `getNotebookMetadata()` in `serializers.ts`. They are not
  controlled by `transientDocumentMetadata` in the current options.

**For execution_count and kernel metadata:** These must still be handled in
the serializer (`extensions/ipynb/`). But since the serializer is Positron-only
code in the `extensions/` directory, we can freely modify it. We have two
sub-options:

a. **Pass a flag through `NotebookData.metadata`:** In the Positron block
   above, after creating the snapshot, set
   `data.metadata._positron_clean_save = true`. The serializer checks this flag
   and strips execution_count / kernel metadata. This is simple and the flag is
   only in the transient data stream, never written to disk.

b. **Read settings directly in the serializer:** The serializer runs in the
   extension host and has access to `vscode.workspace.getConfiguration()`. It
   can read the settings itself. However, it cannot distinguish save from
   backup since it receives the same `NotebookData` for both. With Option 7,
   the outputs are already stripped for save, so the serializer could use
   "outputs are empty" as a heuristic -- but this is fragile (what about
   notebooks that genuinely have no outputs?).

   Sub-option (a) is better.

**Upstream changes:**
- `notebookServiceImpl.ts`: Small modification to
  `createNotebookTextDocumentSnapshot` (~10 lines, wrapped in Positron
  markers).

**Positron-only changes:**
- `notebookServiceImpl.ts`: Positron block as shown above.
- `extensions/ipynb/package.json`: Settings definitions.
- `extensions/ipynb/src/serializers.ts`: Check for metadata flag to strip
  execution_count and kernel metadata.

**Race condition risk:** NONE. The `transientOptions` are constructed fresh on
each call. `context` is a parameter, not shared state. Save and backup can run
concurrently with correct behavior.

**Complexity:** Low-Medium.

**Merge conflict risk:** LOW. The change is a small Positron block inserted
before the existing `model.createSnapshot()` call. Upstream changes to this
function are unlikely to conflict since we are only adding code, not modifying
existing lines.

**What about Path A2 (remote save)?** The optimized remote save path
(`$saveNotebook` in extHostNotebook.ts) bypasses `snapshot()` entirely and
builds the `NotebookData` directly from `document.apiNotebook`. This path
already filters outputs via `serializer.options.transientOutputs` (line 359).
We would need to handle this path separately if we want to support output
stripping for remote saves. However:
- Positron does not currently use the remote save path for local files.
- The remote save path is gated on `NotebookSetting.remoteSaving` config.
- For the initial implementation, we can focus on the standard save path.
- If needed later, the remote save path can be modified similarly (it also has
  access to `serializer.options` and could read settings to override
  `transientOutputs`).

## Recommendation

**Option 7** is the recommended approach. It:

1. Has zero race condition risk (context is per-call, no mutable shared state).
2. Requires minimal upstream modification (one small Positron block in
   `notebookServiceImpl.ts`).
3. Leverages the existing `transientOutputs` mechanism, which is already
   designed for exactly this purpose -- marking outputs as "not for
   persistence."
4. Keeps the serializer changes in Positron-only extension code.
5. Has low merge conflict risk since the upstream change is additive.

**Implementation plan:**

1. Add settings to `extensions/ipynb/package.json`:
   - `ipynb.output.saveOutputs` (boolean, default true)
   - `ipynb.output.saveExecutionCount` (boolean, default true)
   - `ipynb.output.saveKernelInfo` (boolean, default true)

2. Modify `createNotebookTextDocumentSnapshot` in `notebookServiceImpl.ts`:
   - When `context === SnapshotContext.Save` and output stripping is enabled,
     override `transientOptions.transientOutputs = true`.
   - Set a metadata flag `_positron_clean_save = true` on the snapshot data
     if any execution_count or kernel metadata stripping is enabled.

3. Modify `serializeNotebookToString` (or its callers) in
   `extensions/ipynb/src/serializers.ts`:
   - Check for `_positron_clean_save` flag in metadata.
   - If present, strip `execution_count` (set to null) and optionally strip
     `kernelspec` / `language_info` from notebook metadata.
   - Remove the `_positron_clean_save` flag from the output.

4. Update the worker serializer: The worker receives `NotebookData` and calls
   `serializeNotebookToString`. Since the flag is in the metadata of the
   `NotebookData`, the worker will also see it and strip accordingly. No
   special worker changes needed.

5. Handle the `notebookSerializer.node.ts` worker path: The Node.js serializer
   posts `NotebookData` to the worker. The `NotebookData` will already have
   outputs stripped (from step 2) and the metadata flag set (from step 2), so
   the worker's `serializeNotebookToString` will handle execution_count/kernel
   metadata stripping automatically.
