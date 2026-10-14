# Python interpreter ranking and startup: design

- **Updated:** 2026-10-14 (replaces the 2026-09-25 draft)
- **Issues:** [posit-dev/positron#15825](https://github.com/posit-dev/positron/issues/15825) (refactor interpreter prioritization), [posit-dev/positron#16168](https://github.com/posit-dev/positron/issues/16168) (envs one level deeper), [posit-dev/positron#14341](https://github.com/posit-dev/positron/issues/14341) (pyenv at the top of the picker)
- **Builds on:** [posit-dev/positron#16289](https://github.com/posit-dev/positron/pull/16289) (`interpreters.definitions`, `interpreters.discovery`)
- **Plans:** `docs/superpowers/plans/2026-10-06-runtime-startup-core.md` (lands first), `docs/superpowers/plans/2026-09-25-python-startup-policy.md`
- **Shareable copy of the ranking:** `docs/superpowers/specs/python-interpreter-ranking.html`

## Problem

At least four places rank Python interpreters, each with its own idea of a "project environment":

1. `recommendedWorkspaceInterpreterPath` (`positron/manager.ts`): three sequential `findFiles` searches, then `python.defaultInterpreterPath`. Slow (~12s in Posit Cloud), and its non-`Immediate` fallback is saved by core as a 0/0 affiliation that auto-starts on the next open.
2. Upstream `EnvironmentTypeComparer.getRecommended`: filter, then location, `.python-version`, env type, version.
3. `sortInterpreters` (`positron/discoverer.ts`): preferred first, then env type, then version.
4. The `hasFiles` check in the discoverer, which marks whichever interpreter sorted first `Immediate`, including system Pythons.

The result is hard to reason about, and system Pythons auto-start.

## Goals

- One ranked list of interpreters, in one Positron-owned file, that anyone can read top to bottom.
- positron-python decides which interpreter to recommend and whether it should start, from the folder's contents.
- Core decides only the startup mode, session restore, and the affiliated runtime. It never ranks Python interpreters.
- Settings filters (`exclude`, `override`) always win.
- No change to R, to positron-r, or to how the active interpreter (language server, terminals) follows the active console.

## Non-goals

- Changing positron-r or R's startup.
- The active interpreter for the language server and terminals. It follows the active console, as today.
- Making recommendations non-blocking across languages (a perf follow-up in core).
- Removing the JS locator ([#14914](https://github.com/posit-dev/positron/issues/14914)) and PET uv cleanup ([#14484](https://github.com/posit-dev/positron/issues/14484)).
- Multi-root workspaces: only the first folder counts, as today.

## The ranking

### Step 0: Core, before Python is asked

1. **Restored sessions** (window reload, extension host restart): running sessions reconnect and are shown; sessions that have shut down are not reconnected. All languages.
2. **Affiliated runtime** (the interpreter last used in this folder): restored in `auto` and `always`; ignored in `recommended`. Python refuses to start one that `exclude`/`override` now filters out.

### Step 1: Eligibility (filters always win)

| Filter | Effect |
|---|---|
| `python.interpreters.override` is set and the path is not in it | Dropped everywhere |
| Path matches `python.interpreters.exclude` | Dropped everywhere, including definitions, `defaultInterpreterPath`, and project envs |
| Unsupported Python version, Python 2, conda env with no Python | Dropped everywhere |
| No compatible ipykernel (the bundled one when `python.useBundledIpykernel` is on, otherwise one installed in the env), or env type `Unknown` | Listed in the picker, never recommended. Exception: an env inside the workspace, or the pyenv virtualenv named in `.python-version`, is still recommended, so the user is prompted to install ipykernel, as today |

### Discovery scope

- **Normal:** everything PET finds, plus `interpreters.definitions`.
- **`interpreters.discovery: definitionsOnly`:** only `interpreters.definitions` are discovered. Each one ranks by what it is: a definition at the root `.venv` is tier 2, any other definition is tier 6. The launch-shell env and `defaultInterpreterPath` count only if they are also definitions. Ties keep list order.

### Step 2: Rank (first eligible match is the recommended interpreter)

| Tier | Interpreter | Tie-break |
|---|---|---|
| 0 | The env active in the shell Positron was launched from: started from a terminal (`VSCODE_CLI=1`) with `VIRTUAL_ENV` set, or `CONDA_PREFIX` for a non-base conda env (base only if `CONDA_AUTO_ACTIVATE_BASE=false`). Existing exception: with no folder open and a user-scope `python.defaultInterpreterPath`, the setting wins | One value applies |
| 1 | `python.defaultInterpreterPath` set for the folder or workspace, or admin-enforced. Value read with `get()`, scope with `inspect()`; `python` means unset | One value applies |
| 2 | Root project env: `.venv` > `.conda` > `venv` > `.virtualenv` > `.pixi/envs/*`; then the pyenv virtualenv named in the workspace folder's `.python-version` | Fixed order; pixi: `default`, then alphabetical |
| 3 | `python.defaultInterpreterPath` set at user scope | One value applies |
| 4 | The pyenv version named in the workspace folder's `.python-version` (not parent folders) | One value applies |
| 5 | Envs one level deep (`<root>/<child>/{.venv,.conda,venv,.virtualenv}`), then any other env located inside the workspace folder | One level deep: first found, child folders scanned alphabetically, `.venv` > `.conda` > `venv` > `.virtualenv` within a folder. Others: env type, then highest version |
| 6 | Configured: `interpreters.definitions` > environment modules > `python.interpreters.include` > `python.venvPath` > `python.venvFolders` | That order; definitions and folders in list order; then highest version |
| 7 | Positron's default env at `getGlobalEnvironmentDir()` (`$WORKON_HOME/positron`, else `~/.virtualenvs/positron`) | One only |
| 8 | Conda named envs, then pyenv virtualenvs | That order, then highest version |
| 9 | uv base Pythons > conda base > pyenv versions > global virtualenvs (`~/.virtualenvs/<name>`, virtualenvwrapper, poetry/pipenv/hatch/uv envs stored outside the folder) | That order, then highest version |
| 10 | python.org, Windows Store and registry, other Pythons on `PATH` | Highest version |
| 11 | Externally managed and system: Homebrew, Xcode/CLT, distro `/usr/bin`, anything with an `EXTERNALLY-MANAGED` marker | Highest version |

Any remaining tie is broken by path, alphabetically.

- Envs are never searched deeper than one level. An env found one level deep is always tier 5, never tier 2.
- Never recommended, but listed in the picker: env type `Unknown`.
- `.python-version` must name a pyenv virtualenv or an exact pyenv version to count. Otherwise it is only a Python signal.
- Admin-enforced values (`POSITRON_ENFORCED_SETTINGS`) don't show in `inspect()`. A value that `get()` returns but `inspect()` places only at user scope is tier 3; anything else is tier 1. An enforced value identical to the user's own value ranks as tier 3, which is the same interpreter.
- If a recommended interpreter's path has `interpreters.definitions` entries, core starts the first matching definition, not the plain interpreter.

### Active interpreter (language server and terminals)

Unchanged. It follows the active console, so the console and language server never disagree.

## When the recommended interpreter starts

**Python signals**, checked at the folder root and one level deep with direct `readdir` calls (no `findFiles`):

- `*.py`, `*.ipynb`
- `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py`, `setup.cfg`
- `environment.yml`, `.python-version`, `uv.lock`, `pixi.toml`

| Recommended interpreter | Folder | Startup behavior |
|---|---|---|
| Tiers 0-9 | Has Python signals or a root project env | `Immediate`: starts when the folder opens |
| Tiers 0-9 | No Python signals, or no folder open | `Implicit`: starts when a `.py` file is opened or code is run |
| Tiers 10-11 | Any | `Explicit`: starts only when picked. Still the recommendation, so it heads the interpreter picker |
| Every other interpreter | Any | `Explicit`: starts only when picked |

`interpreters.startupBehavior` is applied by core; `"[python]"` wins over the general value.

| Setting | Effect |
|---|---|
| `auto` (default) | Affiliated runtime first, then the recommendation |
| `recommended` | Recommendation only; the affiliated runtime is ignored |
| `always` | Starts a Python runtime in every window: affiliated, else recommended |
| `manual` | Nothing starts automatically |
| `disabled` | Python is not discovered or started. Running sessions are not shut down and are shown after a reload |

## Architecture

### Who decides what

| Owner | Decides |
|---|---|
| Core | Startup mode, session restore, the affiliated runtime, and starting what the extension recommends. When core must pick a runtime itself (file open, Run Line with no console, Quarto, notebooks, `always`), it uses the remembered recommendation. |
| positron-python | The ranking, eligibility, and the startup behavior of its recommendation. Every other Python runtime is `Explicit`. |

### Core changes (`2026-10-06-runtime-startup-core.md`, lands first)

1. **Opt out of the 0/0 save.** `LanguageRuntimeManager.recommendationIsProjectDefault?: boolean` (default `true`). The documented behavior of `recommendedWorkspaceRuntime` is to save a non-`Immediate` recommendation as the project default (a 0/0 affiliation). R relies on that and is untouched. Python sets `false`: core registers its recommendation and remembers it, but never saves it as an affiliation.
2. **Remember the recommendation.** For opted-out managers, core keeps the recommended runtime per language (the first matching definition variant if any) and uses it:
   - in `getPreferredRuntime`, after the console, affiliation and most-recently-started sources, before "any registered runtime";
   - when discovery completes, to start it if it's `Implicit` and a file of that language was opened during startup;
   - for `always`, instead of the first registered runtime.
3. **`recommended` mode ignores affiliations** for implicit starts and for starting an affiliated runtime as it registers (issue #15825 items 1 and 2). This applies to every language, but only changes anything when `recommended` is set.
4. **Session restore** for all languages: after an extension host restart, validate before reconnecting and handle errors; after a reload, running sessions of a `disabled` language reconnect.
5. **Settings precedence** in the New Folder flow.

### Python changes (`2026-09-25-python-startup-policy.md`)

- `positron/workspaceScan.ts`: root project env, envs one level deep, and Python signals, with direct file checks.
- `positron/interpreterRanking.ts`: the ranking as one ordered list of tier rules, a pure function over interpreters plus a context object. The single place that ranks interpreters.
- `recommendedWorkspaceRuntime`: phase 1 resolves tiers 0-4 by path without a PET scan (fast for project envs and settings); phase 2 waits for discovery and ranks everything. Returns the first eligible interpreter with the startup behavior above.
- Discoverer: every runtime `Explicit`; yields in ranked order.
- `createSession` refuses interpreters that `exclude`/`override` filter out; the definitions fallback loop applies the same filter.
- PET kind carried to `PythonEnvironment.nativeKind` (tiers 2 and 8-11 need it).
- Envs one level deep passed to PET as workspace directories.
- Discovery cache: startup flags changed, so a policy version joins the settings digest.
- Deleted: `recommendedWorkspaceInterpreterPath`, `hasFiles`, `sortInterpreters`, the extension's read of `interpreters.startupBehavior`.

## Behavior after the change

| Situation | Today | After |
|---|---|---|
| Root `.venv` | Starts (after ~12s of searches in Cloud) | Starts; the check takes milliseconds |
| Root `.pixi/envs/dev` only | Not recommended | Starts |
| `sub/.venv` only, `sub/main.py` | Not discovered | Discovered and starts (tier 5, signal one level deep) |
| `.py` files, only Homebrew Python | Homebrew starts on open | Nothing starts until Homebrew is picked; it heads the picker |
| `.py` files, pyenv versions + Homebrew | First-sorted starts | Newest pyenv version starts |
| `.py` files, only conda base | conda base starts | conda base starts |
| `defaultInterpreterPath` set at user scope, folder with no signals | Saved as 0/0 affiliation, starts on next open | Starts when a `.py` file is opened |
| `defaultInterpreterPath` set at user scope, root `.venv` | Setting's interpreter starts | `.venv` starts |
| `defaultInterpreterPath` set at workspace scope or admin-enforced, root `.venv` | Setting's interpreter starts | Setting's interpreter starts |
| Root `.venv` in `python.interpreters.exclude` | Starts | Next eligible interpreter |
| Launched from a terminal with a venv active | Language server uses it; console may not | Console starts it too |
| R with `positron.r` default interpreter | 0/0 affiliation, starts on next open | Unchanged |
