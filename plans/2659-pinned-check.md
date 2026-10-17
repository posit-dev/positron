# How the pinned check gets the pinned interpreter without activating every extension first (#2659)

Working doc for Q14 in [2659-pinned-interpreter.md](2659-pinned-interpreter.md). Q14 has the answer. This doc keeps the reasoning and the options we didn't pick.

At every launch, the pinned check replaces a language's affiliated runtime with the pinned interpreter. To do that, core needs the pinned interpreter's runtime metadata, and only the language's extension can build it. The hard requirement: core can't activate every language's extension before step 2 starts the first console. Today step 2 activates only the first language's extension, and the first console would otherwise wait for all of them. This doc works out how core asks each extension for its pinned interpreter within that limit.

Q14 in the plan has an example of the wait this would add, and the plan's "Hard requirement" section has the details. [extension-activation.md](extension-activation.md) explains which extension activations the first console waits for today.

## What any answer has to do

- Ask right after core activates the language's extension, never earlier.
- Not make the first console wait longer than it does today, and not trigger an interpreter search.
- Tell the pinned interpreter apart from the extension's other picks. Only the pinned interpreter is written over the affiliated runtime.
- Leave a path that doesn't work to the extension.
- Finish before step 4 adds that language's interpreters. When step 4 adds an interpreter that matches the affiliated runtime, core can start it right away without checking it first (`runtimeStartup.ts:1616-1650`).

## Answer: a new method (option A)

The runtime manager (the object each extension registers to report its interpreters) gets a new optional method, next to `recommendedWorkspaceRuntime()`:

```ts
pinnedWorkspaceRuntime?(): Thenable<LanguageRuntimeMetadata | undefined>;
```

What the extension returns:

- The runtime metadata for the interpreter its pin setting names. It reads the setting the way it does today.
- Nothing, when no pin is set, the path doesn't lead to an interpreter the extension can use, or `exclude`, `override`, or `definitionsOnly` blocks it.
- It never searches for interpreters. It checks that the file exists, then looks up that one path.
- It doesn't decide when anything starts. Its answer is never marked "start right away".

What core does:

- Calls the method inside `activateExtensionsForLanguages()`, right after a language's extension activates. It asks once per language per window. A later activation call waits for that first answer instead of asking again.
- Steps 2, 3, and 4 all activate extensions through that function, so the check runs at every point in the plan's "Where the pinned check runs" table. After a reconnected console, it runs in step 4.
- If the language has an affiliated runtime and the method returns a runtime, core:
  - builds the first matching `interpreters.definitions` entry, as Q10 says
  - writes it over the affiliated runtime, keeping the old last-started and last-used times, so step 2 starts or skips it the same way it would have the old one
  - registers it with `registerRuntime()`. A registered runtime skips `validateMetadata()` when it starts, and it never reaches the discovery cache.
- Reads the affiliated runtime again in step 2, after the check. Today step 2 reads every affiliated runtime before it activates any extension, then starts the copy it read (`runtimeStartup.ts:1858-1945`).
- If the method returns nothing, leaves the affiliated runtime alone. It starts as it does today.

How it meets each requirement:

- **Ask right after activation:** the check is part of the function core uses to activate extensions.
- **The first console waits no longer:**
  - R only reads files, which takes milliseconds.
  - Python's lookup takes the place of one that already happens. Core skips `validateMetadata()` for a registered runtime (`runtimeSession.ts:1890-1894`). Python's `validateMetadata()` looks up the stored path with `resolveInterpreterWithRetry()`, the same function its recommendation uses for the setting's path (`manager.ts:735`).
  - With nothing pinned, it's one quick call that returns nothing.
- **No interpreter search:** part of the method's contract. Python has to check that the file exists first, which Q8 lists as optional today. It also needs a lookup that doesn't fall back to a full search, like the one Isabel's recommendation uses for setting paths.
- **Tell the pin apart:** the method only ever returns the pin.
- **Bad paths go to the extension:** the extension returns nothing, and the old affiliated runtime starts.
- **Finish before step 4 adds interpreters:** step 4 waits for `activateExtensionsForLanguages()` (`runtimeStartup.ts:1018`) before it loads interpreters from the cache (`1059`).

Two more things A gives:

- **The start reason for #16309.** Core knows it just wrote the pin, so it can pass a "pinned" start reason when step 2 starts it. No new metadata field is needed.
- **The pin and the recommendation agree.** Each extension can build the method and the pinned part of its recommendation from the same function, so the two can't pick different interpreters.

## How this relates to #16376

#16376: R can start in a folder with no R files. R's interpreter search marks an R "start right away" when the open folder has R files. The discovery cache stores that mark with the interpreter, and every folder shares the cache. So the mark is replayed in folders it doesn't fit. The fix is in [16376-discovery-cache-startup.md](16376-discovery-cache-startup.md). Q13 in the plan covers how it fits with a pinned R.

The pin is also an answer for one folder, so it must stay out of the cache too. Only two things write to the cache (`runtimeStartup.ts:793-818`, `1517-1572`):

- interpreters found by discovery
- core's background recheck of cached interpreters, which calls `validateMetadata()`

Option A uses neither. Option C would send the pin through the background recheck.

## Options considered

We picked A. B and C stay here for the record.

**A. A new method.** See the answer above.

**B. A flag on `recommendedWorkspaceRuntime()`.** The pinned interpreter ranks first at every level, so whenever one is set and works, it is the recommendation. A flag would mark it as pinned.

- Adds no method. But core asks for recommendations in step 3 today, not step 2, so this adds a call before the first console.
- If the pinned path is missing, the recommendation keeps going down the ranking. In Isabel's design, if nothing near the top matches, it waits for a full interpreter search.
- The environment active in the shell Positron was launched from ranks above the pin. So when there is one, the recommendation isn't the pin.
- Depends on how Isabel's PR builds the recommendation.

**C. `validateMetadata()` swaps in the pinned runtime.** Core already calls `validateMetadata()` to check a stored runtime before starting it. Under C, the extension returns the pinned runtime instead. R already does this for "current R": if the stored R was the machine's current R, it returns whatever R is current now (`runtime-manager.ts:372-381`).

- Adds no call before the first console.
- Core only calls `validateMetadata()` when it's about to start a stored runtime. For languages step 2 doesn't start, core would have to call it when step 3 or step 4 activates the extension, with nothing about to start. Core never does that today.
- Core also calls `validateMetadata()` in the background to recheck interpreters in the discovery cache, which every folder shares (`runtimeStartup.ts:1517-1568`). If it swaps in one folder's pinned runtime there, that runtime lands in every folder's cache. The extension would need to know which caller it's answering, likely through a new optional argument.
- This is one of the ways #16376 leaks today. R's `validateMetadata()` always answers "start right away" (`runtime-manager.ts:398`), and the background recheck writes that answer back into the cache (`runtimeStartup.ts:1566`).
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
- Core registers each recommendation directly, so it never reaches the cache (`runtimeStartup.ts:1828`).
- If `validateMetadata()` fails at launch, the error also stops step 3. Neither the old affiliated runtime nor any recommendation starts (`runtimeSession.ts:1969-1977`, `runtimeStartup.ts:714-717`).
- Core can read an extension's settings before that extension activates. Settings are registered when extensions are scanned, not when they activate (`configurationExtensionPoint.ts:261-279`, `abstractExtensionService.ts:588`).
- Both extensions activate at every launch anyway, on `onStartupFinished`. Python also activates early when the folder contains files such as `.venv` or `pyproject.toml` (`positron-r/package.json:27-32`, `positron-python/package.json:76-101`). So the limit is on what the first console waits for, not on whether an extension activates.

## Still open

- **How long Python's lookup takes in step 2.** Until Python has a lookup that never falls back to a full search, `resolveInterpreterWithRetry()` can still fall back to a refresh when it misses. `validateMetadata()` does the same today, so the first console waits no longer than it does now. But it isn't faster either. Measure it once Isabel's lookup exists.
