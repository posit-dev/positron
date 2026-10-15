# Pinning an interpreter per workspace (#2659): decisions and open questions

Issue: https://github.com/posit-dev/positron/issues/2659
Proposal comment: https://github.com/posit-dev/positron/issues/2659#issuecomment-6021716658

## Summary

**Today:** `positron.r.interpreters.default` and `python.defaultInterpreterPath` only apply to a workspace that has no affiliated runtime. Once you pick an interpreter in a workspace, that pick becomes the affiliated runtime, and the setting is ignored from then on.

**With this change:** `positron.r.interpreters.default` and `python.defaultInterpreterPath` name a **pinned interpreter**. At every launch, if the workspace has an affiliated runtime for that language, the pinned interpreter is written in as that affiliated runtime. Otherwise it reaches startup as the language's recommendation (https://github.com/posit-dev/positron/issues/15825).

Both setting descriptions need rewriting to match. Today they say the setting stops applying once you pick an interpreter.

## How pinning works

Step numbers in this plan are today's steps, from [interpreter-startup-today.md](interpreter-startup-today.md):

1. Reconnect consoles
2. Start affiliated runtimes
3. Start recommendations
4. Find interpreters
5. Start after the search

Step 3 uses Isabel's Python ranking, [python-startup-policy-design.md](python-startup-policy-design.md). #2659 needs that ranking to put python.defaultInterpreterPath first at every level. Then the recommendation and the pinned check pick the same interpreter, whether or not the folder has an affiliated runtime. Isabel and Dhruvi agreed to this on 2026-10-15. Only the environment active in the shell Positron was launched from ranks higher.

### Where the pinned check runs

It runs right after core activates a language's extension, never earlier.

| Step | What it does today | What #2659 adds |
|---|---|---|
| 1. Reconnect consoles | Reconnects consoles that are still running | Nothing. A reconnected console keeps its interpreter (Q6). |
| 2. Start affiliated runtimes | Activates the extension for the most recently used language, then starts its affiliated runtime. Other languages follow in the background. | The pinned check runs for each language between activating its extension and starting its affiliated runtime. So the affiliated runtime that starts is the pinned one. The recommendation step handles starting the pinned interpreter when there is no affiliation. |
| 3. Start recommendations | Activates every language's extension and asks each for a recommendation | If a language already has an affiliated runtime from an earlier session, but step 2 doesn't start it, then step 3 is where the pinned check updates the affiliated runtime. This happens when `interpreters.startupBehavior` is `manual` OR `recommended` and step 2 didn't start a console for another language. Nothing starts, but the affiliated runtime now points at the pinned interpreter. |
| 4. Find interpreters | Activates every language's extension, if it isn't active yet | The pinned check updates the affiliated runtime for any language whose extension first activates here. This happens when step 1 reconnected a console, OR step 2 started one language but not another. For example, Python is set to auto and starts in step 2, while R is set to manual. Nothing starts, but the affiliated runtime now points at the pinned interpreter. |
| 5. Start after the search | Starts an interpreter marked "start right away", or starts an interpreter for any language whose `interpreters.startupBehavior` is set to `always` | Nothing |

Example of the pinned check in step 3: 
R is set to `manual`. Last week you picked R 4.3 and used its console, so R 4.3 is the folder's affiliated runtime. The pinned R is 4.4.

1. You open the folder. Step 2 doesn't start R, because R is `manual`. Step 3 activates the R extension, and the pinned check replaces R 4.3 with R 4.4 in the affiliated runtime. Nothing starts yet.
2. You run a line of R code. Running code starts the affiliated runtime, so R 4.4 starts.

Without the check in step 3, R 4.3 would start. The same goes for anything else that asks for the folder's preferred interpreter (`getPreferredRuntime()`), such as Quarto and notebooks. 

NOTE: We do not need to worry about the case where `interpreters.startupBehavior` is `recommended` because that is handled by https://github.com/posit-dev/positron/issues/15825 which will recommend the pinned interpreter if there is one. 

### Hard requirement: the pinned check must not activate every language's extension before step 2 starts a console

Today step 2 is deliberately fast. It activates only the extension for the first affiliated language, then starts that runtime using the metadata stored in the affiliation (`runtimeStartup.ts:1919-1929`). The extension checks and rebuilds that metadata just before it starts the interpreter. Other affiliated languages activate and start in the background. Activating every language's extension first would hold up the first console until all of them finish.

So the pinned check can't ask every extension for its pinned interpreter up front. It needs two things without activating extensions early:

1. **Whether a language has a pinned interpreter set**.
2. **Runtime metadata for the pinned path**, so it can be written into the affiliation.

**Proposed timing:** core checks each extension for a pinned interpreter right after core activates it, never earlier. [extension-activation.md](extension-activation.md) explains which extension activations the first console waits for today.

The discovery cache can't be the only source of metadata. It has no entry for the pinned path when:

- the cache is turned off with `interpreters.discoveryCache.enabled` (`languageRuntime.ts:433`)
- the entry is older than `interpreters.discoveryCache.maxAgeDays` and has been removed
- discovery never found the path, for example a project-local `${workspaceFolder}/.rvenv/bin/R` outside every folder discovery searches
- the pinned path is new, for example after a `git pull` changed the setting

## Questions

### Q1. What sets the pinned interpreter?

The existing settings: `positron.r.interpreters.default` for R, and `python.defaultInterpreterPath` for Python. No new setting is added.

`${workspaceFolder}/blah/R` is only an example path for the docs.

### Q2. Does a pinned interpreter replace the affiliated runtime, at every setting level?

Yes. At every launch, the pinned check writes the pinned interpreter over the affiliated runtime, so the runtime that step 2 would start is the pinned interpreter. This holds wherever the setting is set: admin-enforced, folder, workspace, or user. If it's set at more than one level, the pinned check uses the value VS Code resolves in that order. That's the value the Settings editor shows as active.

This setting overrides any other signal that would effect WHAT interpreter we auto-start. If you use this setting, you are telling us that this is the interpreter you want us to start.

An affiliated runtime is a side effect of whatever ran last on your machine. If we respected the existing affiliated runtime instead of overwriting it, the setting would stay a first-run default, as it is today, which is NOT what we want.

### Q3. Does the pinned interpreter decide when something starts, or only what starts?

The `positron.r.interpreters.default` and `python.defaultInterpreterPath` decide WHAT starts. 
The `interpreters.startupBehavior` controls WHEN an interpreter starts.

In a new workpsace when `interpreters.startupBehavior` is:
- `always`,  the pinned interpreter starts when a folder is opened.
- `auto`, the pinned interpreter starts when a folder is opened and the folder has language files. Otherwise it starts when you open one of those files or run code.
- `recommended`, the pinned interpreter starts when the folder opens and the folder has files for that language. Otherwise it starts when you open one of those files or run code.
- `manual`, nothing auto-starts.
- `disabled`, nothing auto-starts.

In a workspace where the language already has an affiliated runtime, `always` and `auto` start the pinned interpreter when the folder opens. The other options behave the same as described above.

### Q4. What if the user picks a different interpreter during a session?

It works as it does today. Picking an interpreter doesn't change what the setting will do at startup.

The picked interpreter becomes the affiliated runtime. The next time the folder opens, the pinned check changes the affiliated runtime back to that language's pinned interpreter. That includes when Positron reconnects to a console that's still running, such as after a window reload. The picked console will keep running, but the affiliated runtime goes back to the pinned interpreter.

### Q5. What happens if the setting's value changes while Positron is running?

For example, you edit the setting, or a `git pull` updates `.vscode/settings.json`. Nothing changes until the next time Positron starts in this folder. The running console keeps its interpreter, because shutting it down would lose work.

Removing the setting works the same way. On the next launch, the pinned check finds nothing to write, and the affiliated runtime starts as it would with nothing pinned. That's whichever interpreter last came to the front. It's usually the pinned one, or your own pick if you picked a different interpreter after the last launch.

Python has one exception today. With no folder open, or in a folder where Python has never started a console, changing `python.defaultInterpreterPath` starts a Python console with the new value right away. That's usually a folder without Python files. #2659 doesn't change this. This comes from reading the code (`interpreterPathService.ts:71-112`, `manager.ts:164-189`).

### Q6. What happens when Positron reconnects to a console that's still running?

The console keeps running with its data, even if it isn't the pinned interpreter. Nothing else starts, for any language. This is how Positron works today, so it needs no new code.

Positron reconnects to a running console when:
- You run Developer: Reload Window.
- Positron asks you to reload, for example after you install or update an extension.
- You refresh the browser tab, or reconnect, in Positron Server or Workbench.
- You reopen Positron Desktop, and kernelSupervisor.shutdownTimeout is set to keep kernels running after Positron closes.

The pinned check still runs when each language's extension activates, so the affiliated runtime goes back to the pinned interpreter. The pinned interpreter starts the next time the folder opens and there isn't a console still running.

If the console has stopped by the time Positron comes back, for example because the shutdown timeout ran out or the computer restarted, there's nothing to reconnect to. Startup runs as a normal launch, with the pinned interpreter in place of the old affiliated runtime.

### Q7. In a multi-root workspace, whose pinned interpreter wins?

A window has one affiliated runtime per language, so the pinned check writes one pinned interpreter per language.

- Python: the first folder's value. `python.defaultInterpreterPath` can be set per folder, so Python reads it for the first folder, in VS Code's order: that folder's value, then the `.code-workspace` value, then the user value. Today Python gets this order wrong. It picks `workspaceValue || workspaceFolderValue || globalValue`, which puts the `.code-workspace` value above the folder value (`manager.ts:399-401`). Isabel's design fixes this by reading the value with `get()`.
- R: the `.code-workspace` value, then the user value. `positron.r.interpreters.default` is a window-level setting, so VS Code doesn't allow a per-folder value in a multi-root workspace. That already matches one affiliated runtime per window, so R needs no change.

In a single-folder window, `.vscode/settings.json` is the workspace level, and both extensions already read it.

### Q8. What if the pinned path is missing, broken, or a system python?

You can set the setting to any path. The language's extension decides what to do with it.

Already handled:
- A Python that Positron doesn't recommend or doesn't auto-start, such as a system Python: the existing warnings handle it.
- A Python that exists but fails to start: Positron tries to start the console and shows the existing errors. That's the ipykernel install prompt, or the "exited unexpectedly" notification with the "Open Logs" button.

We may want to change this scenario:
- The path doesn't lead to a Python that Positron can run: Today, there's no console to start. The pinned check writes nothing, so the existing affiliated runtime starts instead. If there isn't one, the usual startup rules apply.

We could instead:
- Have the Python extension shows a notification with an "Open Settings" button. Today the failure only reaches the log. For example: "python.defaultInterpreterPath is set to /opt/python/3.11/bin/python, but no Python was found there. Started Python 3.12.4 (.venv) instead."
- The extension checks that the file exists before looking it up. Today a missing path makes Python run a full interpreter search before it gives up, which slows startup.

Changes are optional and easy to add later if needed.

### Q9. Does a pinned interpreter get past `interpreters.exclude`, `interpreters.override`, and `definitionsOnly`?

No. These settings must win, matching #15825 item 5. Otherwise a committed `.vscode/settings.json` could get around an admin's restriction. A pinned path that these settings block is treated like a path that doesn't work. The pinned check writes nothing, and the existing affiliated runtime starts instead.

**Today**

- **R**
  - `positron.r.interpreters.exclude` and `positron.r.interpreters.override` aren't applied to the pinned path. R marks an excluded R as not usable (`r-installation.ts:328-334`), but its recommendation doesn't check that (`runtime-manager.ts:157-160`).
  - Under `definitionsOnly`, R makes no recommendation at all (`runtime-manager.ts:149`).
- **Python**
  - `python.interpreters.exclude` and `python.interpreters.override` aren't applied to the pinned path. The recommendation doesn't check them (`manager.ts:430-461`). Interpreters found by discovery are checked before Python registers them, so an excluded Python never shows up in the interpreter list (`manager.ts:471`).
  - Under `definitionsOnly`, Python makes no recommendation at all (`manager.ts:432`).
- **Core** refuses to start an interpreter that isn't in `interpreters.definitions` when `definitionsOnly` is set (`runtimeSession.ts:1917-1924`).

**Changes needed**

- **R:** when R turns the pinned path into runtime metadata, return nothing if that R isn't usable. That covers `exclude` and `override`, plus an R that's too old or isn't a real install. Under `definitionsOnly`, report no pinned R, the same as the recommendation does today. Both changes go in the same place as the conda/pixi fix.
- **Python:** none in #2659. Isabel's design drops `python.defaultInterpreterPath` when `exclude` matches it or `override` doesn't include it. Under `definitionsOnly`, it counts the path only if it's also in `interpreters.definitions`.

### Q10. When several `interpreters.definitions` entries share the pinned path, which one starts?

An `interpreters.definitions` entry is a labeled variant of the interpreter at a path, started with extra environment variables or a startup script (`interpreterDefinitions.ts:20-30`). Several entries can share one path. Example: you pin `/usr/local/bin/python3.12`, and `interpreters.definitions` lists that path twice, `3.12 (GPU)` first, then `3.12 (CPU)`.

Today's plan starts different things depending on whether there's an affiliated runtime:

- **No affiliated runtime, or under `recommended`:** the recommendation starts. Isabel's design says "If a recommended interpreter's path has `interpreters.definitions` entries, core starts the first matching definition, not the plain interpreter." So `3.12 (GPU)` starts.
- **An affiliated runtime under `auto` or `always`:** the pinned check writes the plain interpreter at that path. So plain 3.12 starts, not either entry.
- **You pick `3.12 (CPU)` during a session:** the affiliated runtime keeps the entry's label, and core rebuilds the entry before starting it (`runtimeSession.ts:1903-1913`). On the next launch, the pinned check replaces it with the pinned interpreter, as for any other pick.

**Answer:** the pinned check writes the first matching entry, the same one the recommendation would start. Then `3.12 (GPU)` starts in every case. To pin `3.12 (CPU)` instead, see Q11.

Core can do this itself with helpers that already exist: `getMatchingDefinitions()` finds the entries for the same language and path, in list order, and `createInterpreterVariant()` builds that entry's runtime (`interpreterDefinitions.ts:61-84`). Making no change is also possible, but then the first launch starts `3.12 (GPU)` and every later launch starts plain 3.12.

### Q11. Should a pin be able to name an entry's label, not just a path? (optional)

A path can't always say what you want to pin:

- **Several entries share one path.** Pinning a path picks the first entry (Q10), so you can't pin `3.12 (CPU)` without reordering the list.
- **Environment modules.** Their interpreter path isn't necessarily known at startup, so a path can't pin them at all.

One idea is to let the pin name a path, a label, or both. Still open: which setting would hold the label. `python.defaultInterpreterPath` is an upstream setting that expects a path, and Q1 says no new setting is added.

#2659 doesn't need this. With the Q10 answer, a path pin already starts the same entry every time. It's worth doing later if people need to pin a specific entry or an environment module.

### Q12. Does a pinned R inside a conda or pixi environment start with that environment activated?

Yes, the same as an R found any other way. Today it doesn't.

R detects the environment with `packagerMetadataForPath()`. R found through `positron.r.customBinaries`, `customRootFolders`, or `registerRuntimeFromPath()` gets that check (`provider.ts:1153`, `runtime-manager.ts:411`), but the pinned path doesn't (`runtime-manager.ts:159`). So a pinned `${workspaceFolder}/.pixi/envs/default/bin/R` starts without its environment.

The fix is to call `packagerMetadataForPath()` when the R extension turns the pinned path into runtime metadata. That covers both the pinned check and R's recommendation. The docs in https://github.com/posit-dev/positron-website/pull/486 already assume this works.

### Q13. How do we stop the machine's current R from starting ahead of a pinned R in a new folder?

**The problem.** This only affects a folder where R has no affiliated runtime yet. That's the first time you open a folder, or the next launch after you shut down the R console, because shutting it down deletes the affiliated runtime.

In that folder, two things want to start R:

- R's recommendation returns the pinned R, marked to start when you open an R file (`runtime-manager.ts:157-160`).
- R's interpreter search marks the machine's current R to start right away when the folder has R files at any depth, or when the folder is empty and you used RStudio in the last 30 days (`provider.ts:311-337`, `1337-1360`). Step 5 starts it if nothing else is running and no language has an affiliated runtime.

Today the pinned R wins by accident. Core saves R's recommendation as an affiliated runtime that never started. Any affiliated runtime stops step 5, so the current R doesn't start. Nothing starts on the first open, and the pinned R starts on the second.

**Isabel's core change 1.** Isabel's design lists five core changes that land before her Python changes (see "Core changes" in [python-startup-policy-design.md](python-startup-policy-design.md)). The first one lets each language decide whether core saves its recommendation as an affiliated runtime before that recommendation has started:

> 1. **Opt out of the 0/0 save.** `LanguageRuntimeManager.recommendationIsProjectDefault?: boolean` (default `true`). The documented behavior of `recommendedWorkspaceRuntime` is to save a non-`Immediate` recommendation as the project default (a 0/0 affiliation). R relies on that and is untouched. Python sets `false`: core registers its recommendation and remembers it, but never saves it as an affiliation.

A "0/0 affiliation" is the saved affiliated runtime described above. Its last-started and last-used times are both zero, because it never started. A "non-`Immediate`" recommendation is one that isn't marked to start right away, like R's pinned R.

We don't want to keep that save for R. It makes the pinned R start on the second open instead of the first, and it stops step 5 for every other language on that first open. But without the save, nothing blocks step 5, and the current R starts on the first open instead of the pinned R.

**Answer**

- R turns off the save, the same way Python does (`recommendationIsProjectDefault: false`).
- When a pinned R is set, R's recommendation marks it to start right away in the same cases where R's search marks the current R today, listed above. Otherwise it's marked to start when you open an R file.
- When a pinned R is set, R's search marks nothing to start right away.

So the pinned R starts in the same situations where the current R starts today, and nothing can start ahead of it. Users without a pinned R see no change.

All three changes are in the R extension, as part of #2659. Isabel's core change 1 has to land first, so the option exists. Turning off the save also gives R Isabel's core change 2: core remembers R's recommendation and uses it when core has to pick an R itself, such as under `always`, for Quarto and notebooks, or when you run R code with no console.

One visible change for pinned users: today a pinned R starts on the second open of any folder, because of the saved affiliated runtime. After this change, in a folder with no R files, it waits until you open an R file or run R code, as Q3 describes.

### Q14. How does the pinned check get a language's pinned interpreter from its extension? (open)

Not answered yet. The options and findings so far are in [2659-pinned-check.md](2659-pinned-check.md). Once it's decided, the answer goes here.

## To check during implementation

Both items depend on Isabel's core changes, not on #2659. Check them when her core PR lands.

- **Opening a file can start an interpreter that isn't the pinned one.**
  - Problem: Q3 says that if the pinned interpreter hasn't started, opening a file for that language starts it. Today, opening a file starts the first registered interpreter for that language that's marked to start when a file opens (`runtimeSession.ts:265-281`). It doesn't look at the affiliated runtime or the recommendation.
  - What should happen: start the affiliated runtime if there is one, otherwise the recommendation. Under `recommended`, start the recommendation.
  - To do: check that Isabel's core change 2 does this for both Python and R. Her design says that when core has to pick an interpreter itself, including on file open, it uses the remembered recommendation. R only gets this once it turns off the save in Q13.
- **Under `recommended`, step 4 starts the affiliated runtime.**
  - Problem: under `recommended`, the affiliated runtime should never start on its own. Today step 4 starts it when the interpreter search registers it (#16380 item 2). So the pinned interpreter starts when the folder opens, even in a folder with no files for that language, which Q3 says should wait. If the pinned check hasn't finished by then, the old affiliated runtime starts instead.
  - To do: check that Isabel's core change 3 stops this. Her design says "`recommended` mode ignores affiliations for implicit starts and for starting an affiliated runtime as it registers."
