# Pinning an interpreter per workspace (#2659): decisions and open questions

Issue: https://github.com/posit-dev/positron/issues/2659
Proposal comment: https://github.com/posit-dev/positron/issues/2659#issuecomment-6021716658

## Summary

**Today:** `positron.r.interpreters.default` and `python.defaultInterpreterPath` only apply to a workspace that has no affiliated runtime. Once you pick an interpreter in a workspace, that pick becomes the affiliated runtime, and the setting is ignored from then on.

**With this change:** each setting names a **pinned interpreter**. At every launch, the pinned interpreter is written in as the workspace's affiliated runtime for that language. Startup then runs as it does today, so the affiliated runtime that starts is the pinned one.

## How pinning works

The pinned interpreter does not add a new step that competes with the affiliation. It **replaces** the affiliation, and the rest of startup is unchanged. This keeps the core change small and puts it in one place.

At launch, `startupSequence()` (`runtimeStartup.ts:660`) would run these steps:

| Step | What happens | Changed? |
|---|---|---|
| 1. Restore sessions | Reconnect to sessions that are still running. If any console comes back, the later steps don't auto-start anything. | No |
| 2. Write pinned runtimes | Find each language's pinned interpreter (how we do this is still an open question, see Q9, Q19, and Q20). For each language with a valid pinned interpreter, write it into the stored affiliation. See the rules below. | **New**, and runs earlier than today's recommendation step. Must not activate extensions early (see the hard requirement below). |
| 3. Start affiliated runtimes | Start the affiliated runtime for each language, using today's rules. | No |
| 4. Recommendations | Extensions' guesses (such as Python's `.venv` detection) fill in an affiliation only where none exists. | The step's code doesn't change, but it only receives guesses now. Today it also receives the setting value, which moves to step 2. |

### Hard requirement: step 2 must not activate every language's extension before step 3

From review: we must not activate every language's extension before starting the affiliated runtimes.

Today step 3 is deliberately fast. It activates only the extension for the first affiliated language, then starts that runtime using the metadata stored in the affiliation (`runtimeStartup.ts:1919-1929`). The extension checks and rebuilds that metadata just before the start (see Q20). Other affiliated languages activate and start in the background. Activating every language's extension first would hold up the first console until all of them finish.

So step 2 can't simply ask each extension for its pinned interpreter. It needs two things without activating extensions early:

1. **Whether a language has a pinned interpreter set** (Q19).
2. **Runtime metadata for the pinned path**, so it can be written into the affiliation (Q20).

When the affiliation already points at the pinned path, which is the usual case after the first launch, neither is needed beyond a path comparison.

The discovery cache can't be the only source of metadata. It has no entry for the pinned path when:

- the cache is turned off with `interpreters.discoveryCache.enabled` (`languageRuntime.ts:433`)
- the entry is older than `interpreters.discoveryCache.maxAgeDays` and has been removed
- discovery never found the path, for example a project-local `${workspaceFolder}/.rvenv/bin/R` outside every folder discovery searches
- the pinned path is new, for example after a `git pull` changed the setting

Whatever step 2 does when the cache has no entry must also meet this requirement.

### Rules for step 2

- **The language already has an affiliation.** Replace its runtime with the pinned one, and keep its `lastUsed` / `lastStarted` timestamps. The timestamps are what step 3 uses to decide whether to start it, so keeping them means the pinned interpreter changes **which** runtime starts, not **whether** it starts.
- **The language has no affiliation.** Write the pinned runtime the same way today's code writes a recommended runtime: zero timestamps, after step 3 (`runtimeStartup.ts:1828-1841`). It can't be written before step 3. Step 3 starts a lone affiliation regardless of its timestamps (`runtimeStartup.ts:1883`), so writing a new one early would start a runtime that wouldn't start today.
- **The pinned interpreter is missing, broken, or blocked by a setting.** Write nothing. The existing affiliation stays and starts as usual. Show a notification (Q5).

### What follows from this

- A dropdown pick during a session is still saved as the affiliation, as today. The next launch writes the pinned runtime over it.
- Removing the setting leaves the last pinned runtime as the affiliation, not the last dropdown pick.
- `getPreferredRuntime()` (`runtimeStartup.ts:1757`) reads the affiliation, so anything that asks for "the preferred R" gets the pinned R.
- "Clear Saved Interpreter" clears the affiliation, but on a pinned workspace the next launch writes the pinned runtime back.
- Cost: any work step 2 does before step 3 delays the first console. That's why the hard requirement above limits it.

## Questions

### Q1. What sets the pinned interpreter?

The existing settings: `positron.r.interpreters.default` for R, and `python.defaultInterpreterPath` for Python. No new setting is added.

`${workspaceFolder}/.rvenv/bin/R` is only an example path for the docs. Positron does not look for a `.rvenv` folder on its own. Nothing in the R world creates `.rvenv`, so detecting it would mean inventing a Positron-only folder convention.

### Q2. Does a pinned interpreter beat the affiliated runtime at startup?

Yes. Step 2 writes the pinned runtime over the affiliation at every launch, so the affiliation that step 3 starts is the pinned one.

Why: a pinned interpreter is something someone wrote down on purpose, often committed so the whole team gets it. An affiliation is a side effect of whatever ran last on one machine. If the affiliation won, the setting would stay a first-run default, as it is today.

### Q3. At which setting levels does the setting pin an interpreter?

All of them. The value step 2 writes is the one VS Code resolves in its normal order: admin-enforced > folder > workspace > user. This matches what the Settings editor shows as active.

Known costs:

1. Anyone with a user-level value today gets it written over the affiliation in every workspace after upgrading. That replaces picks they made in those workspaces.
2. With a user-level pinned interpreter, a dropdown pick lasts only until the window closes. The next launch writes the pinned runtime back.
3. `python.defaultInterpreterPath` comes from upstream VS Code, where it's a first-run default. Positron will behave differently.

These need a release note and new setting descriptions.

### Q4. Does the pinned interpreter decide whether something starts, or only which?

Only which. Step 2 replaces the runtime but keeps the timestamps, and it writes new affiliations where today's code writes recommendations. So step 3 starts something exactly when it would today. `interpreters.startupBehavior` still applies: under `manual`, nothing auto-starts.

Example: a user-level pinned R in a project where R has never run. R gets an affiliation with zero timestamps, the same as a recommended R today. It does not start on its own.

### Q5. What if the pinned path is missing or broken?

Step 2 writes nothing for that language. The existing affiliation starts in step 3 as usual, or normal rules apply if there is none. The failure is made visible:

- A notification, once per window, naming the pinned path, why it failed, and what started instead, with an Open Settings button
- A log message
- A start reason for pinned starts (building on the session start reasons work in #16309), so the console info popup shows when a session started because its interpreter was pinned

Why: falling back silently would leave people on the wrong version without knowing. Refusing to start would punish a teammate whose machine doesn't have a committed path.

### Q6. What if the user picks a different interpreter during a session?

Nothing special happens, and Positron shows no message. Users start, stop, and switch consoles freely. Each pick is saved as the affiliation, as today. On the next launch, step 2 writes the pinned runtime over it, so the pinned interpreter is what starts. That's one per language, and other languages follow their normal rules.

### Q7. Does the pinned interpreter apply when sessions are restored?

No. Restored sessions win. A window reload or a Workbench reconnect keeps the running session and its data.

This needs no new code. Step 1 restores sessions. Every auto-start path after it first checks "is any console starting or running" with no language filter (`runtimeStartup.ts:331`, `708`, `714`, and the affiliated start in `onDidRegisterRuntime`). So a restored session of any language blocks steps 3 and 4, including under `startupBehavior: always`. Step 2 can still write the pinned runtime, so the next fresh launch starts it.

If a restored session turns out to be dead, it isn't restored. Steps 2-4 then run normally, and the pinned interpreter starts.

### Q8. Where does a pinned Python interpreter sit relative to `.venv` detection? (open)

Today `recommendedWorkspaceInterpreterPath()` (`extensions/positron-python/src/client/positron/manager.ts:271-312`) checks, in order:

1. A `.venv` folder
2. A `.conda` folder
3. Any `*/bin/python` one level down
4. Only then `python.defaultInterpreterPath`

So a `.venv` beats the setting at every level.

Separately, core starts the affiliated runtime **before** it asks extensions for a recommendation (`runtimeStartup.ts:705-715`). So the affiliation also beats `.venv`. If you pick Python 3.11 from the dropdown in a project with a `.venv`, 3.11 starts on reopen, not the venv. Dhruvi didn't know this, and it may be something #15825 plans to change.

Under the pinning design, `.venv` detection is a guess (step 4) and the setting names a pinned interpreter (step 2). Left as is, any pinned interpreter, including a user-level one, would beat `.venv`. The user level matters most here, because many people coming from VS Code have `python.defaultInterpreterPath` in user settings.

Scenario: user settings point at `/usr/local/bin/python3.12`. You clone a project that has its own `.venv`.

| Option | What starts |
|---|---|
| A. Any pinned interpreter beats `.venv` | The global 3.12. Packages installed in the venv are missing. |
| B. A workspace- or folder-level pinned interpreter beats `.venv`; `.venv` beats a user-level one | The project's `.venv`. A workspace-level pinned interpreter, if set, beats both. |
| C. `.venv` beats every pinned interpreter (today) | The project's `.venv`, even when the project's own settings pin something else. |

If B is chosen, the Python extension handles it in step 2: when the project has a `.venv`, `.conda`, or `*/bin/python`, it doesn't report a user-level pinned interpreter. Core doesn't need to know. The order would be:

| Project has | Order on launch ("folder", "workspace", "user" = the pinned interpreter set at that level) |
|---|---|
| `.venv` / `.conda` / `*/bin/python` | folder > workspace > affiliation > `.venv` detection (user not reported) |
| None of those | folder > workspace > user > affiliation |

B has to work this way to stay consistent. A simpler "folder > workspace > `.venv` > user > affiliation" would mean adding a user-level pinned interpreter flips whether your own dropdown pick sticks in a venv project.

B as described needs the Python extension to check for a `.venv` during step 2, which means it is active before step 3. That runs into the hard requirement. Core could check for the folders itself, but that puts Python-specific rules in core. See Q19.

Questions for Isabel:

1. What does #15825 plan to change about this order? In particular, should the affiliation keep beating `.venv`?
2. Should a user-level `python.defaultInterpreterPath` beat a project's `.venv`?

### Q9. How does core learn about a pinned interpreter? (open)

Step 2 needs each extension to report its pinned interpreter separately from its guesses. Today extensions report a workspace's runtime through one method, `recommendedWorkspaceRuntime()` (`src/positron-dts/positron.d.ts:1230`). It returns one runtime or nothing, and that answer mixes:

- **Pinned interpreters:** R's `interpreters.default`, Python's `defaultInterpreterPath`
- **Guesses:** Python's `.venv` / `.conda` / `*/bin/python` detection

Core needs to tell them apart, because they're handled differently:

- A pinned interpreter is written in step 2 and replaces an existing affiliation.
- A guess is written in step 4 and only fills an empty one.

Core also needs to learn when a pinned interpreter is set but broken, so it can show the Q5 notification. Today a missing path comes back as "nothing."

| Option | How it works |
|---|---|
| A. New optional method for pinned interpreters | e.g. `pinnedWorkspaceRuntime()`, returning the pinned runtime or "interpreter pinned at path X, failed because Y." `recommendedWorkspaceRuntime()` returns guesses only. |
| B. Flag on the existing method | `recommendedWorkspaceRuntime()` also reports pinned vs guessed, plus failure details. |
| C. Core reads the settings itself | Each language declares its pinning setting in `package.json`. Core reads it, resolves `${workspaceFolder}`, and calls the existing `registerRuntimeFromPath()` (`positron.d.ts:1313`). |

Every option has to meet the hard requirement. A and B are methods on the extension, so the extension has to be active before it can answer. With C, core can tell whether a setting is set without activating anything, but `registerRuntimeFromPath()` still runs in the extension. Q19 and Q20 cover those two parts separately.

### Q10. Does a pinned R get its conda or pixi environment?

Yes, in scope. When the R extension turns the pinned path into a runtime for step 2, it should run `packagerMetadataForPath()`. That function detects whether the binary is inside a conda or pixi environment, so the session starts with the environment activated.

R found through `customBinaries`, `customRootFolders`, or `registerRuntimeFromPath()` already gets this check (`provider.ts:1153`, `runtime-manager.ts:411`). The `interpreters.default` path skips it today (`runtime-manager.ts:159`). So a pinned interpreter like `${workspaceFolder}/.pixi/envs/default/bin/R` would start without its environment. The docs in posit-dev/positron-website#486 already assume this works.

### Q11. In a multi-root workspace, whose pinned interpreter wins?

There is one affiliation per language for the whole window, so step 2 writes one pinned runtime per language. It comes from the first folder's value, then the `.code-workspace` value, then the user value. That's VS Code's normal order for the first folder.

Neither extension reads the setting in that order today, so both need a small change:

- R reads the setting with no folder (`interpreter-settings.ts:187`), so it never sees folder-level values. R needs to pass the first folder's URI, which matches how it already resolves `${workspaceFolder}`.
- Python passes the first folder's URI (`manager.ts:346-347`), but then picks `workspaceValue || workspaceFolderValue || globalValue` (`manager.ts:309-312`). That ranks the `.code-workspace` value above the folder value, the reverse of VS Code's order. Python needs to use VS Code's order.

### Q12. What happens when the pinned interpreter changes mid-session?

Nothing until the next launch, and no message. Step 2 only runs at launch, so a changed pinned interpreter is written then. Shutting down a running session because of a settings edit or a `git pull` would lose work. The setting descriptions change from "Requires a restart" to something like "Takes effect the next time Positron starts."

### Q13. Does an admin-enforced Workbench value pin an interpreter?

Yes, for both languages. Step 2 uses the final resolved value, and an enforced value from `POSITRON_ENFORCED_SETTINGS` beats every other level. Enforced settings come in through the policy configuration layer (`configurationService.ts:58`).

What the code shows:

- Core's `getValue()` lays policy values, including enforced ones, over every other level (`configurationModels.ts:1003-1006`). R reads with `get()`, which goes through the same merge, so R should see the enforced value.
- An extension's `inspect()` reports the policy value only as `defaultValue` (`extHostConfiguration.ts:302`). Python reads only `globalValue`, `workspaceValue`, and `workspaceFolderValue` (`interpreterSettings.ts:499-518`), so it misses an enforced value. Python needs to account for the policy value too.

This comes from reading the code. It hasn't been tested. Before relying on it, check on Workbench that an enforced `positron.r.interpreters.default` and `python.defaultInterpreterPath` reach the extension host, and that R sees its value while Python today does not.

### Q14. Does a pinned interpreter get past `interpreters.exclude`, `interpreters.override`, and `definitionsOnly`?

No. Those limits win, matching #15825 item 5. A pinned interpreter at a blocked path is treated as a failed one: step 2 writes nothing, and the Q5 notification names the setting that blocked it. `definitionsOnly` already blocks the recommendation today (`runtime-manager.ts:149`, `manager.ts:341`).

Why: otherwise a committed `.vscode/settings.json` could get around an admin's restriction.

### Q15. Does this close #2659?

Yes. The issue's other ideas are either done or separate:

| Idea from the issue | Status |
|---|---|
| Relaunch "whatever we did last time" | The affiliation, which exists today |
| Follow the current R after an upgrade | Done in #2535 / #2652 |
| A setting that pins R for a workspace | This plan |
| One package library per R minor version (`R_LIBS_USER`) | Not in scope. A new issue if anyone wants it. |

### Q16. How does it ship?

One PR containing:

- The core change: step 2, the failure notification and start reason (Q5), and the handling of blocked pinned interpreters (Q14)
- The extension API for reporting pinned interpreters (Q9)
- The R changes: conda/pixi (Q10) and folder-level values (Q11)
- The Python changes: the pinned interpreter vs `.venv` order (Q8) and reading enforced values (Q13)
- The setting descriptions

Docs in positron-website#486 follow. The PR waits until Q8, Q9, Q18, Q19, and Q20 are settled.

### Q17. Tests

| Behavior | Test |
|---|---|
| Step 2 replaces an existing affiliation's runtime and keeps its timestamps | Vitest, `runtimeStartup.vitest.ts` |
| Step 2 writes a new affiliation after step 3, with zero timestamps, so nothing new starts | Vitest |
| A failed pinned interpreter writes nothing and reports why (not found, invalid, blocked) | Vitest |
| A restored session blocks the start | Vitest |
| R reads folder-level values; pinned R gets conda/pixi info | Vitest where reachable without `vscode`, otherwise extension host tests |
| Pick a different R, restart, the pinned R comes back | Extend `test/e2e/tests/interpreters/default-r-interpreter.test.ts` |
| Same for Python | Extend `default-python-interpreter.test.ts` once Q8 is settled |
| Admin-enforced pinned interpreter on Workbench | Manual |

The existing e2e tests only cover a workspace with no affiliation. That's the one case where the old and new behavior agree.

### Q18. Should a pinned interpreter start under `startupBehavior: recommended`? (open)

`interpreters.startupBehavior` already has a `recommended` value (`languageRuntimeService.ts:824`). Its description says an interpreter "will start when the extension providing the interpreter recommends it." #15825 item 2 confirms the intent: under `recommended`, the affiliated runtime should not start when a folder reopens.

Today the step that starts affiliated runtimes (step 3) only runs for languages set to `always` or `auto` (`runtimeStartup.ts:1862`). Under `recommended`, it skips the language. Recommendations (step 4) still start.

That matters for this design, because the pinned runtime is stored as the affiliation. Left as is, a pinned interpreter would not start under `recommended`, even though step 2 wrote it.

Scenario: a user sets `startupBehavior: recommended` for Python. The project's `.vscode/settings.json` pins Python 3.11, and the project also has a `.venv`.

| Option | What starts on reopen |
|---|---|
| A. A pinned interpreter counts as a recommendation | Python 3.11. Under `recommended`, a dropdown pick still doesn't start on reopen, but a pinned interpreter does. |
| B. A pinned interpreter is an affiliation, and `recommended` skips it | The `.venv`, which comes from step 4. The pinned interpreter only decides what starts under `always` and `auto`. |

Questions for Isabel:

1. Is `recommended` meant to skip dropdown picks only, or anything stored as the affiliation?
2. Does the answer change if the pinned interpreter comes from user settings instead of the project?

### Q19. How does step 2 learn a language has a pinned interpreter without activating its extension? (open)

What the code shows:

- Only the extensions know which setting pins the interpreter for their language: `positron.r.interpreters.default` for R, `python.defaultInterpreterPath` for Python. No core code reads either setting today.
- Each extension also has its own rules for reading the value:
  - Both replace `${workspaceFolder}` with the first folder, expand `~`, and ignore relative paths (`resolveSettingPath()`).
  - Python treats the value `python` as unset (`interpreterSettings.ts:506`).
  - Python checks for `.venv`, `.conda`, and `*/bin/python` before it reads the setting (`manager.ts:283-307`). See Q8.
- Core can read an extension's settings before that extension activates. Settings are registered when extensions are scanned, not when they activate (`configurationExtensionPoint.ts:261-279`, `abstractExtensionService.ts:588`).
- Both extensions activate at every launch anyway, on `onStartupFinished`. Python also activates early on `workspaceContains` for files such as `.venv` and `pyproject.toml` (`positron-r/package.json:27-32`, `positron-python/package.json:76-101`). So the requirement is about activating before step 3, not about whether they activate.

Questions:

1. Where should the knowledge "this setting pins this language's interpreter" live: in each extension, or in core?
2. However step 2 learns about a pinned interpreter, how does it stay consistent with each extension's own rules for reading the setting, including Q8?

### Q20. How does step 2 get runtime metadata for the pinned path without activating extensions early? (open)

What the code shows:

- At launch, the stored affiliation's runtime usually isn't registered yet. So before starting it, core asks the extension to check and rebuild the metadata with `validateMetadata()` (`runtimeSession.ts:1890-1898`). That happens after step 3 has activated that one extension.
- Only the extension can build the metadata. The runtime ID is a hash of the path and the version, and the version comes from the extension reading the installation (R `provider.ts:778-781`, Python `runtime.ts:226-227`).
- Turning a path into metadata costs about what starting an affiliated runtime costs today:
  - R reads files only, which takes milliseconds (`r-installation.ts:253-394`).
  - Python resolves the path through its environment locator. That can take up to 15 seconds, or about 90 seconds in the worst case with a full refresh, and it may run Python (`positron/util.ts:71-74`, `129-149`).
- The discovery cache can't be relied on, beyond the cases listed under the hard requirement:
  - There is no lookup by path.
  - Interpreters inside a workspace folder, and Python virtual environments, are never cached (`provider.ts:578-626`, `positron/runtime.ts:61-98`).
  - R discovery doesn't look at the `interpreters.default` path (`provider.ts:408-456`).
- `registerRuntimeFromPath()` turns a path into metadata, but it also writes the path into a user-level setting (`runtime-manager.ts:410-414`, `manager.ts:675-683`).
- If `validateMetadata()` fails at launch, the error escapes the `try` in `startupSequence()`. Neither the old affiliation nor the recommendations start (`runtimeSession.ts:1969-1977`, `runtimeStartup.ts:714-717`). This matters for the Q5 fallback.

Questions:

1. Does the requirement allow activating an extension before step 3 if its language has a pinned interpreter? Or must step 2 never activate an extension that step 3 wouldn't activate anyway?
2. Is Python's path resolution time acceptable before the first console starts?
3. How should a failed pinned interpreter fall back to the old affiliation (Q5), given that a validation failure today stops the rest of startup?

## To check during implementation

These follow from the design. They weren't decided in the Q&A:

- **Opening a file later in the session.** The path that starts a runtime when you open a file of that language skips any language that has an affiliation (`runtimeStartup.ts:422-430`). Once a pinned runtime is stored as the affiliation, that path behaves as it does today for any affiliated runtime. If that means nothing starts, the gap already exists for every affiliation, not just pinned ones.
- **R's "newest R" guess.** When a folder looks like an R project, R discovery marks the newest R to start right away (`provider.ts:327-337`). The path that starts it doesn't check the affiliation (`runtimeStartup.ts:406-410`). Confirm it can't start ahead of the pinned R.
