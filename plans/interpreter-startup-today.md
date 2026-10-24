# How interpreter startup works today

- **What this is:** existing behavior only, read from `origin/main` at `03551d9f56`. Nothing here has been run unless it says so.
- **Why it exists:** the plans refer to these step numbers. New behavior lives elsewhere:
  - [interpreter-startup-meanings.md](interpreter-startup-meanings.md) says what each step should do after the startup redesign.
  - [2659-pinned-interpreter.md](2659-pinned-interpreter.md) says what pinned interpreters add.

## When a folder opens

`startupSequence()` (`runtimeStartup.ts:660-723`) runs steps 1 to 4 in order. Step 5 runs when step 4 finishes.

| Step | What happens | When it runs | Code (`runtimeStartup.ts` unless noted) |
|---|---|---|---|
| 1. Reconnect consoles | Reconnects consoles that were still running. These are consoles from before a window reload, or sessions that keep running on the machine after Positron closes. | Every open | `673`, `2064-2229` |
| 2. Start affiliated runtimes | Starts the affiliated runtime of each language set to `always` or `auto`. It activates the extension for the most recently used language, then starts that console, before going on. Other affiliated languages activate and start in the background. | Only if no console is starting or running after step 1 | `708-711`, `1858-1947` |
| 3. Start recommendations | Activates every language's extension and asks each one to recommend an interpreter for the folder. Starts each recommendation marked "start right away". Saves any other recommendation as the language's affiliated runtime, if it has none, with both timestamps at zero. | Only if no console is starting or running after step 2 | `714-716`, `1804-1853` |
| 4. Find interpreters | Loads interpreters from the cache, runs a full search for languages whose cache is out of date, or both. As each interpreter is added, if it's the folder's affiliated runtime and no console is showing, it starts. | Every open | `722`, `984-1141`; starting as interpreters are added: `1583-1666` |
| 5. Start after the search | Starts the first interpreter marked "start right away". If there's none, starts the first interpreter added for one language set to `always`. | Only if no language has an affiliated runtime and no console is starting or running | `316-391` |

## Later in the session

| What happens | What starts | Code |
|---|---|---|
| An interpreter marked "start right away" is added after step 5 | That interpreter, if no console is starting or running | `runtimeStartup.ts:400-411` |
| You open a file | The first interpreter added for that language that's marked "start when a file opens". It ignores the affiliated runtime and the recommendation, and it skips an interpreter marked "start right away" that never started (not run). | `runtimeSession.ts:243-281`; `runtimeStartup.ts:413-430` if the file opened before step 5 |
| You run code with no console for that language | The affiliated runtime, else the most recently started interpreter, else the first one added | `positronConsoleService.ts:876-893`, `runtimeStartup.ts:1764-1780` |

## How each step checks `interpreters.startupBehavior`

| Step | `always` | `auto` | `recommended` | `manual` | `disabled` |
|---|---|---|---|---|---|
| 1. Reconnect consoles | Reconnects | Reconnects | Reconnects | Reconnects | Fails after a reload, because adding the interpreter throws (`languageRuntime.ts:162-170`; from #16380 item 3, not reproduced) |
| 2. Start affiliated runtimes | Starts | Starts | Skipped | Skipped | Skipped |
| 3. Start recommendations | Starts | Starts | Starts | Refused (`runtimeSession.ts:1748-1756`) | The extension isn't asked |
| 4. Start as interpreters are added | Starts | Starts | Starts (#16380 item 2, reproduced) | Skipped | Not searched |
| 5. Start after the search | Starts | Starts | Starts | Skipped | Skipped |
| Later: you open a file | Starts | Starts | Starts | Nothing | Nothing |
| Later: you run code | Starts | Starts | Starts | Starts | Nothing to start |

`always` adds one more start in step 5: if nothing is marked "start right away", it starts the first interpreter added for a language set to `always`. That's one language only, even when several are set to `always`.

## Who marks an interpreter "start right away"

- **R's interpreter search** marks its first R when the folder has R files at any depth. It also does this in an empty folder if you used RStudio in the last 30 days. The current R sorts first (`provider.ts:311-337`, `1337-1360`).
- **R's recommendation** returns only a pinned R, marked "start when a file opens" (`runtime-manager.ts:147-168`).
- **R's `validateMetadata()`** always marks "start right away" (`runtime-manager.ts:398`). Cache checks add its answer (`runtimeStartup.ts:1547-1553`), which can start R after step 5.
- **Python's interpreter search** marks its top interpreter when the folder has Python files (`discoverer.ts:75-112`). If that interpreter has no ipykernel and lives outside the folder, it's marked "only when picked", and no Python is marked (`runtime.ts:198-216`).
- **Python's recommendation** marks a root `.venv`, `.conda`, or `*/bin/python` "start right away". Otherwise it returns `python.defaultInterpreterPath`, marked "start when a file opens". Under `manual` it marks nothing "start right away" (`manager.ts:362-414`).
- **The cache** stores the mark as given. It replays one folder's mark in other folders (#16376).

## Rules the steps share

- **Used** means the console came to the front, as the console showing in the Console pane. That's when Positron saves the affiliated runtime and its "last used" time (`runtimeStartup.ts:923-947`). The first console Positron starts on its own comes to the front right away (`runtimeSession.ts:2150-2155`).
- **Step 2 skips some affiliated runtimes.** It skips one that never started, or that started and wasn't used. It does this only when two or more languages have one. A language's only affiliated runtime starts whatever its timestamps (`runtimeStartup.ts:1884-1915`).
- **Any affiliated runtime blocks step 5 for every language.** That includes one saved in step 3 that never started.
- **A reconnected console blocks steps 2, 3, and 5 for every language.** Step 4's start is blocked too, because a console is showing.
- **Shutting a console down deletes its affiliated runtime** (`runtimeStartup.ts:952-970`).
