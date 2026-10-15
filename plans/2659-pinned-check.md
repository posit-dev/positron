# How the pinned check gets the pinned interpreter (#2659)

Working doc for Q14 in [2659-pinned-interpreter.md](2659-pinned-interpreter.md). Once this has an answer, the answer goes back into that plan.

At every launch, the pinned check replaces a language's affiliated runtime with the pinned interpreter. To do that, core needs the pinned interpreter's runtime metadata, and only the language's extension can build it. This doc works out how core asks the extension for it.

The "Hard requirement" section of the plan explains why the check can't make the first console wait for every extension. [extension-activation.md](extension-activation.md) explains which extension activations the first console waits for today.

## What any answer has to do

- Ask right after core activates the language's extension, never earlier.
- Not make the first console wait longer than it does today, and not trigger an interpreter search.
- Tell the pinned interpreter apart from the extension's other picks. Only the pinned interpreter is written over the affiliated runtime.
- Leave a path that doesn't work to the extension.
- Finish before step 4 adds that language's interpreters. When step 4 adds an interpreter that matches the affiliated runtime, core can start it right away without checking it first (`runtimeStartup.ts:1616-1650`).

## Options so far

**A. A new method.** A new optional method on the runtime manager (the object each extension registers to report its interpreters) returns the pinned runtime's metadata, or nothing.

- Adds one call before the first console when a language is pinned. Core registers the runtime it gets back, and a registered runtime skips the `validateMetadata()` call core makes today before starting a stored runtime (`runtimeSession.ts:1890-1894`). So the first console should wait about as long as it does now.

**B. A flag on `recommendedWorkspaceRuntime()`.** The pinned interpreter ranks first at every level, so whenever one is set and works, it is the recommendation. A flag would mark it as pinned.

- Adds no method. But core asks for recommendations in step 3 today, not step 2, so this adds a call before the first console.
- If the pinned path is missing, the recommendation keeps going down the ranking. In Isabel's design, if nothing near the top matches, it waits for a full interpreter search.
- Depends on how Isabel's PR builds the recommendation.

**C. `validateMetadata()` swaps in the pinned runtime.** Core already calls `validateMetadata()` to check a stored runtime before starting it. Under C, the extension returns the pinned runtime instead. R already does this for "current R": if the stored R was the machine's current R, it returns whatever R is current now (`runtime-manager.ts:372-381`).

- Adds no call before the first console.
- Core only calls `validateMetadata()` when it's about to start a stored runtime. For languages step 2 doesn't start, core would have to call it when step 3 or step 4 activates the extension, with nothing about to start. Core never does that today.
- Core also calls `validateMetadata()` in the background to recheck interpreters in the discovery cache, which every folder shares (`runtimeStartup.ts:1517-1568`). If it swaps in one folder's pinned runtime there, that runtime lands in every folder's cache. The extension would need to know which caller it's answering, likely through a new optional argument.
- `validateMetadata()` returns a runtime, not why it picked it. To show "started because pinned" in the console info popup (#16309), the metadata would need a new optional field.

## Ruled out

- **Core reads the setting itself.** Only the extension can turn a path into runtime metadata, so core would still have to ask the extension. Each extension also has its own rules for reading the value (see below). And the extension decides what to do with a path that doesn't work.
- **The extension pushes its pinned runtime to core when it activates.** VS Code decides when an extension activates. The push could arrive after step 2 has already started the old affiliated runtime.
- **Activate every language's extension before the first console.** The first console would wait for all of them, which review ruled out. It would also undo #12645, which made step 2 activate only the first language's extension.

## What the code shows

- Only the extensions know which setting pins their interpreter. No core code reads `positron.r.interpreters.default` or `python.defaultInterpreterPath` today.
- Each extension has its own rules for reading the value. Both replace `${workspaceFolder}` with the first folder, expand `~`, and ignore relative paths (`resolveSettingPath()`). Python treats the value `python` as unset (`interpreterSettings.ts:506`).
- Only the extension can turn a path into runtime metadata. The runtime ID is a hash of the path and the version, and the version comes from the extension reading the installation (R `provider.ts:778-781`, Python `runtime.ts:226-227`).
- Turning a path into metadata takes about as long as the check core already runs before starting an affiliated runtime. R only reads files, which takes milliseconds (`r-installation.ts:253-394`). Python looks the path up through its environment locator. That can take up to 15 seconds, or about 90 seconds in the worst case when it falls back to a full search, and it may run Python (`positron/util.ts:71-74`, `129-149`). Isabel's recommendation looks up setting paths without a full search, which may be cheaper. That hasn't been measured.
- Today a missing `python.defaultInterpreterPath` makes Python run a full interpreter search before it gives up (`positron/util.ts:139-148`). Checking that the file exists first avoids it.
- `registerRuntimeFromPath()` also turns a path into metadata, but it writes the path into a user-level setting as a side effect (`runtime-manager.ts:410-414`, `manager.ts:675-683`).
- The discovery cache can't stand in for the extension. It has no lookup by path, and it never stores interpreters inside a workspace folder or Python virtual environments (`provider.ts:578-626`, `positron/runtime.ts:61-98`). R's discovery doesn't look at the `positron.r.interpreters.default` path (`provider.ts:408-456`).
- If `validateMetadata()` fails at launch, the error also stops step 3. Neither the old affiliated runtime nor any recommendation starts (`runtimeSession.ts:1969-1977`, `runtimeStartup.ts:714-717`).
- Core can read an extension's settings before that extension activates. Settings are registered when extensions are scanned, not when they activate (`configurationExtensionPoint.ts:261-279`, `abstractExtensionService.ts:588`).
- Both extensions activate at every launch anyway, on `onStartupFinished`. Python also activates early when the folder contains files such as `.venv` or `pyproject.toml` (`positron-r/package.json:27-32`, `positron-python/package.json:76-101`). So the limit is on what the first console waits for, not on whether an extension activates.

## Open questions

1. Is checking right after activation acceptable, including inside step 2?
2. Which option: A, B, or C?
