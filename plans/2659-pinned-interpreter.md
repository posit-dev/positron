# Pinning an interpreter per workspace (#2659): decisions and open questions

Issue: https://github.com/posit-dev/positron/issues/2659
Proposal comment: https://github.com/posit-dev/positron/issues/2659#issuecomment-6021716658

This records the questions Dhruvi worked through while planning #2659, the answer to each, and why. Q8 and Q9 are still open and need input from Isabel. They are marked "(open)". Two related items from #15825 are at the end.

## Summary

**Today:** `positron.r.interpreters.default` and `python.defaultInterpreterPath` only apply to a workspace that has no affiliated runtime. Once you pick an interpreter in a workspace, that pick becomes the affiliated runtime, and the setting is ignored from then on.

**With this change:** each setting names a **pinned interpreter**. At every launch, the pinned interpreter is written in as the workspace's affiliated runtime for that language. Startup then runs as it does today, so the affiliated runtime that starts is the pinned one.

## How pinning works

The pinned interpreter does not add a new step that competes with the affiliation. It **replaces** the affiliation, and the rest of startup is unchanged. This keeps the core change small and puts it in one place.

At launch, `startupSequence()` (`runtimeStartup.ts:660`) would run these steps:

| Step | What happens | Changed? |
|---|---|---|
| 1. Restore sessions | Reconnect to sessions that are still running. If any console comes back, the later steps don't auto-start anything. | No |
| 2. Write pinned runtimes | Ask each language's extension for its pinned interpreter (how we do this is still an open question, see Q9). For each language with a valid pinned interpreter, write it into the stored affiliation. See the rules below. | **New**, and runs earlier than today's recommendation step |
| 3. Start affiliated runtimes | Start the affiliated runtime for each language, using today's rules. | No |
| 4. Recommendations | Extensions' guesses (such as Python's `.venv` detection) fill in an affiliation only where none exists. | The step's code doesn't change, but it only receives guesses now. Today it also receives the setting value, which moves to step 2. |

Rules for step 2:

- **The language already has an affiliation.** Replace its runtime with the pinned one, and keep its `lastUsed` / `lastStarted` timestamps. The timestamps are what step 3 uses to decide whether to start it, so keeping them means the pinned interpreter changes **which** runtime starts, not **whether** it starts.
- **The language has no affiliation.** Write the pinned runtime the same way today's code writes a recommended runtime: zero timestamps, after step 3 (`runtimeStartup.ts:1828-1841`). It can't be written before step 3. Step 3 starts a lone affiliation regardless of its timestamps (`runtimeStartup.ts:1883`), so writing a new one early would start a runtime that wouldn't start today.
- **The pinned interpreter is missing, broken, or blocked by a setting.** Write nothing. The existing affiliation stays and starts as usual. Show a notification (Q5).

What follows from this:

- A dropdown pick during a session is still saved as the affiliation, as today. The next launch writes the pinned runtime over it.
- Removing the setting leaves the last pinned runtime as the affiliation, not the last dropdown pick.
- `getPreferredRuntime()` (`runtimeStartup.ts:1757`) reads the affiliation, so anything that asks for "the preferred R" gets the pinned R.
- "Clear Saved Interpreter" clears the affiliation, but on a pinned workspace the next launch writes the pinned runtime back.
- Cost: step 2 has to resolve the pinned path before anything starts. Python resolves it with a retry (`manager.ts:356`), so the first console may start a little later.

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

Leaning B. With this design, B is a choice the Python extension makes in step 2: when the project has a `.venv`, `.conda`, or `*/bin/python`, it doesn't report a user-level pinned interpreter. Core doesn't need to know. The resulting order:

| Project has | Order on launch ("folder", "workspace", "user" = the pinned interpreter set at that level) |
|---|---|
| `.venv` / `.conda` / `*/bin/python` | folder > workspace > affiliation > `.venv` detection (user not reported) |
| None of those | folder > workspace > user > affiliation |

The order has to look like this to stay consistent. A simpler "folder > workspace > `.venv` > user > affiliation" would mean adding a user-level pinned interpreter flips whether your own dropdown pick sticks in a venv project.

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

Leaning A:

- Steps 2 and 4 each get their own call.
- The failure result gets its own shape.
- Runtime extensions without a pinning setting don't have to change.
- Language-specific choices stay in the extension, including how Q8 is answered.

Dhruvi hasn't decided and wants Isabel's input.

### Q10. Does a pinned R get its conda or pixi environment?

Yes, in scope. When the R extension turns the pinned path into a runtime for step 2, it should run `packagerMetadataForPath()`. That function detects whether the binary is inside a conda or pixi environment, so the session starts with the environment activated.

R found through `customBinaries`, `customRootFolders`, or `registerRuntimeFromPath()` already gets this check (`provider.ts:1153`, `runtime-manager.ts:411`). The `interpreters.default` path skips it today (`runtime-manager.ts:159`). So a pinned interpreter like `${workspaceFolder}/.pixi/envs/default/bin/R` would start without its environment. The docs in posit-dev/positron-website#486 already assume this works.

### Q11. In a multi-root workspace, whose pinned interpreter wins?

There is one affiliation per language for the whole window, so step 2 writes one pinned runtime per language. It comes from the first folder's value, then the `.code-workspace` value, then the user value.

Python already reads the setting this way (`manager.ts:346`). R reads it with no folder (`interpreter-settings.ts:187`), so it never sees folder-level values. R needs to pass the first folder's URI, which matches how it already resolves `${workspaceFolder}`. This option needs the least change.

### Q12. What happens when the pinned interpreter changes mid-session?

Nothing until the next launch, and no message. Step 2 only runs at launch, so a changed pinned interpreter is written then. Shutting down a running session because of a settings edit or a `git pull` would lose work. The setting descriptions change from "Requires a restart" to something like "Takes effect the next time Positron starts."

### Q13. Does an admin-enforced Workbench value pin an interpreter?

Yes, for both languages. Step 2 uses the final resolved value, and an enforced value from `POSITRON_ENFORCED_SETTINGS` beats every other level. Enforced settings come in through the policy configuration layer (`configurationService.ts:58`).

- R reads with `get()`, which should already return the enforced value.
- Python reads with `inspect()` and only looks at `globalValue`, `workspaceValue`, and `workspaceFolderValue` (`interpreterSettings.ts:499-518`). As far as we know, `inspect()` has no field for policy values, so Python likely misses an enforced value today. Python needs to read the final value as well.

This is inferred, not confirmed. Verify by hand on Workbench.

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

Docs in positron-website#486 follow. The PR waits until Q8 and Q9 are settled.

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

## To check during implementation

These follow from the design. They weren't decided in the Q&A:

- **Opening a file later in the session.** The path that starts a runtime when you open a file of that language skips any language that has an affiliation (`runtimeStartup.ts:422-430`). Once a pinned runtime is stored as the affiliation, that path behaves as it does today for any affiliated runtime. If that means nothing starts, the gap already exists for every affiliation, not just pinned ones.
- **R's "newest R" guess.** When a folder looks like an R project, R discovery marks the newest R to start right away (`provider.ts:327-337`). The path that starts it doesn't check the affiliation (`runtimeStartup.ts:406-410`). Confirm it can't start ahead of the pinned R.

## Also open: items from #15825

- **Item 2** proposes `interpreters.startupBehavior: recommended`, under which the affiliated runtime does not start on reopen. Since the pinned runtime is stored as the affiliation, how should it behave under `recommended`? The working assumption is that a pinned interpreter counts as "recommended" and starts.
- **Item 5** says exclude and override beat `defaultInterpreterPath` and `interpreters.default`. This plan agrees (Q14).
