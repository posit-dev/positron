# Positron package commands

Reading, installing and updating the packages in an interpreter session. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Read the environment, never probe it

To find out what is installed, what version it is, or whether something newer
is available, call `positronPackages.getAllPackages` (the whole environment) or
`positronPackages.getPackages` (specific packages, by name). **Do not run code
to find out.** Writing `import pandas` in a try/except, calling `pip list`,
`installed.packages()`, `importlib.metadata.version()`, or anything similar
through `executeCode` is the wrong move every time: it runs code the user did
not ask for, it can have side effects (an import executes module-level code),
it only answers for the one package you thought to test, and it tells you
nothing about whether a newer version exists.

These commands have none of those problems. They change nothing, show the user
nothing, and need no pane open. Reach for one before any package operation, and
before answering any question about what the session has.

**Which of the two to call:**

- To size up the environment, or list what is installed, call
  `getAllPackages`. It returns a compact entry per package, built to fit
  hundreds of packages at once.
- To look a package (or a few) up by name -- its full detail, its security
  vulnerabilities, or simply *whether it is installed at all* -- call
  `getPackages` with the names. A named package that is missing comes back in
  `notFound`, which is a definitive "not installed"; the compact list can be
  large, so do not conclude a package is absent just because you did not spot
  it there.

## Reading what's installed

### `positronPackages.getAllPackages`

Reports every package installed in the foreground session, each with its
installed version and whether a newer one is available. A **compact** list: the
`description` is shortened to 256 characters (suffixed with `...` when cut), and
security vulnerabilities and the per-package detail fields (license, author,
source repository, publication date) are left out entirely to keep the whole
environment inside the token budget. When you need the full description, the
detail fields, or the vulnerabilities for a package, call `getPackages` with its
name.

Read-only and quiet. Unlike the write commands below, this has **no
precondition** -- it is always callable, and tells you in its payload when it
has nothing to say. So a `disabled` failure from a write command does not mean
you cannot read.

**Reading the payload:**

- `available: false` comes with a `reason`, and each one calls for a different
  response:
  - `disabled` -- the user turned the Packages pane off in settings. Say so;
    do not offer to turn it on by running code.
  - `no-session` -- nothing is running, so there is no environment to
    describe. Ask the user to start an interpreter.
  - `session-not-ready` -- a session is starting up (or has exited). This one
    is worth retrying shortly; the others are not.
  - `unsupported` -- this runtime has no package manager. Nothing here will
    work for it.
  - `failed` -- the read itself failed; relay `message` rather than guessing.
- `metadataStatus` says how far `outdated` can be trusted. Only `fresh` means
  the repositories were queried just now. On `cached`, `timed-out` or
  `fetch-failed`, report update information as possibly stale rather than
  telling the user they are up to date. On `unsupported`, no package has
  `outdated` at all, so its absence means nothing.
- `session` names the session the answer describes. It is one session's
  environment, not the machine's -- do not carry an answer across a session
  switch or apply it to a different language.
- `attached` is not the same as installed. A package can be installed but not
  attached (not `library()`d in R, not imported in Python). "Is pandas
  available?" is answered by the package appearing in the list at all;
  `attached` only says whether it is on the search path right now.

{{command:positronPackages.getAllPackages}}

### `positronPackages.getPackages`

Reports **full detail** on the packages you name: the full description plus the
detail fields (license, author, source repository, publication date) and the
security vulnerabilities that `getAllPackages` leaves out. Pass an array of
names (matching is case-insensitive). Use it to look a package up rather than
scanning the whole list, and to answer "is X installed?" reliably.

**Reading the payload:**

- `packages` holds the named packages that **are** installed, with full detail.
- `notFound` holds the names that are **not** installed. A name here is a
  definitive "not installed" -- that is the reason to name packages rather than
  to search the compact list, which can be large.
- `metadataStatus` and `vulnerabilityStatus` mean the same as elsewhere (see
  above and the advisories section below).
- The same `available: false` reasons apply. In addition, if you call it
  without any names it returns `reason: 'no-names'` -- pass the package names.

{{command:positronPackages.getPackages}}

## Security advisories

`getPackages` carries known security advisories against each named package's
installed version, so a question about whether a package is vulnerable is
answered by `getPackages` -- not by a web search, and not by running an auditing
tool. (`getAllPackages` omits advisories to stay compact, so name the packages
you care about and call `getPackages`.)

**The three states of `vulnerabilities` are all meaningful, and conflating
them is the easiest mistake to make here:**

- A non-empty array -- this installed version is affected.
- An **empty** array -- the advisory host was asked and reports nothing
  against this version. That is a genuine all-clear; say so.
- **Absent** -- there is no advisory data for this package. Nothing can be
  concluded either way. Do not report it as clean.

**Reading an advisory:** entries are pre-sorted worst-first, so the first one
is the headline and matches what the Packages pane shows the user. `severity`
is always present (`critical`/`high`/`medium`/`low`/`unscored`) and is the
field to rank by. `unscored` means the advisory carries no CVSS score, which
is common for CRAN's RSEC records -- it means "vulnerable, severity unknown",
not "probably fine". `id` is the CVE when one exists, otherwise the OSV id.

**`vulnerabilityStatus`** is tracked separately from `metadataStatus` because
the two come from different places: outdated state from the runtime's package
manager, advisories from Posit Package Manager. Either can fail while the
other answers, so check the one that matches the claim you are making. On
`disabled`, `unavailable` or `timed-out`, do not tell the user they have no
vulnerabilities -- you did not find out.

**Whether to call again** -- the status tells you, and only one value is worth
a second call:

- `fresh` or `cached` -- the advisory data is as complete as it gets. A package
  with none was already looked up for you, so calling again returns the same
  thing. Don't.
- `timed-out` -- the lookup ran out of time partway. The package list is
  complete, but some packages carry only what was cached, possibly nothing.
  Calling again resumes where it stopped, so this is the one case where a
  second call adds information.
- `disabled` or `unavailable` -- no advisory data is coming. `disabled` means
  the user turned advisory lookups off in settings; `unavailable` means the
  lookup ran and produced nothing, because either no Package Manager here
  reports advisories or the lookup failed. Neither is worth retrying: say what
  you could not determine and stop.

**Attribution:** when `vulnerabilitySource` is present, say where the data
came from (`host`) and when (`fetchedAt`). Advisory data has a date; presenting
it as timeless fact overstates it.

**Fixing one:** `fixedIn` is display text, and may name fixes on several
release branches (`"1.26.5, 2.0.2"`). It is deliberately not
machine-comparable, so do not pass it to `updatePackage` as a version. Pick
one with the user, then update to that exact version. Do not reach for
`updateAllPackages` to fix a single advisory.

## Installing, updating and refreshing

`installPackage` and `updatePackage` take the same argument pair: `name`, then
`version`. For `version`, pass an exact version when the user named one,
`'latest'` when they just want the newest. Read `version` back off the result
to learn what `'latest'` actually resolved to, rather than predicting it or
telling the user a version you did not confirm.

Never invent a package name from a partial request. If the user says "install
the plotting one", ask which.

### `positronPackages.installPackage`

Installs a package that is not there yet. If the package is **already
installed, this does nothing at all**, whatever `version` says -- it will not
move an installed package to a different version. Use `updatePackage` for
that. So look the package up with `getPackages` first: it tells you whether it
is installed, and so which of the two commands the user actually needs.

Base R installs ignore `version` entirely and always take the current release
from the repository. Do not promise a specific version on an R session using
the base installer.

{{command:positronPackages.installPackage}}

### `positronPackages.updatePackage`

Moves an already-installed package to a different version. Returns
`updated: false` with a `message` when the installed version is already the
newest available -- that is a normal outcome, not an error; relay it rather
than retrying.

As with install, base R updates ignore `version`.

{{command:positronPackages.updatePackage}}

### `positronPackages.updateAllPackages`

Updates every installed package in the session to its latest available
version. Use when the user asks to update all their packages. This can take a
while for a large environment -- say so before starting.

Prefer `updatePackage` when the user named specific packages. Updating
everything to fix one package is a much larger change than they asked for.

{{command:positronPackages.updateAllPackages}}

### `positronPackages.refreshPackages`

Refreshes the Packages pane's list. Use when a package was installed or
removed outside Positron (from a terminal, say) and the pane looks stale.

This is for the *pane*. To read the installed list yourself, use
`getAllPackages`, which reads live and does not need this first.

{{command:positronPackages.refreshPackages}}

## Preconditions, and what a failure means

`installPackage`, `updatePackage`, `updateAllPackages` and `refreshPackages`
all share one precondition: the Packages pane must be enabled in settings,
**and** a session must be active, **and** no package operation may already be
running.

That last clause is the one to watch. A `disabled` failure does not
necessarily mean the feature is off or the session is missing -- it may simply
mean an install or update is in flight. Wait and tell the user an operation is
already running; do not retry in a loop, and do not conclude packages are
unavailable. `getAllPackages` and `getPackages` still work while an operation
runs, so use one to tell the cases apart.

## After installing or updating

A newly installed or upgraded package often cannot be loaded until the session
restarts, because the old version may already be loaded in memory. Positron
prompts the user about this itself, so do not pre-empt it.

If the user does ask you to restart, use
`workbench.action.language.runtime.restartActiveSession` from
[troubleshooting.md]({{skill_dir}}/references/troubleshooting.md) -- and tell
them first that a restart **discards all session state** (variables, loaded
packages, history). Never restart silently as a cleanup step.

To show the user the result, focus the Packages pane with
`workbench.view.positronPackages.view.focus` from
[ui.md]({{skill_dir}}/references/ui.md).
