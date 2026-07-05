# bump-ark

`bump-ark` is a script and a thin skill wrapper around it. The script can be run with just `python3` (no deps) and assumes the `gh` CLI is properly configured.

The script creates a Positron-side PR that bumps the submodule ref, and fills the PR description automatically. If called again, the script updates the PR with a new submodule bump (if needed) and a refreshed description. The automated PR description includes:

- The set of E2E tags requested by the caller (`@:ark` is always included).

- The relevant release notes from the Ark PRs covered by the submodule bump

- A "Closes #XXX" line for every issue mentioned in the release notes, and every "Addresses #XXX" mention in the Ark PRs.

- A commit section listing every commit since the last bump.


#### Usage

The script (and skill) takes the following arguments:

- A source: This can be an Ark PR number, or "main". When set to an Ark PR, the script tracks changes from the current submodule ref to the PR branch tip (or its merge commit once the PR is merged). When set to main, it tracks changes up to Ark's remote main tip.

- A list of E2E tags to include in the Positron PR to expand the active set of tests on CI.

- `--dry-run` to generate a PR description without pushing anything on github.

- `--confirm` to bypass the author protection in case of a "bump to latest main" PR (see below).


#### Bump to PR branch mode

You call the script with the PR number to open a Positron PR and run CI tests. If needed, you then iterate on your branch and reinvoke the script to update the Positron PR and refresh CI tests.

Make sure to include the relevant release notes in your Ark PR so the script can generate up-to-date release notes in the Positron PR.

When ready, merge your branch to main and invoke the script one last time. The Positron side PR will now point to the merge commit on main. This works no matter the merge type (squash or branch merge).

If there is other work committed to main, the script will find the release notes of the corresponding PRs. That's on purpose: If your submodule bump includes other people's work, the entire set of changes should be documented here. That's often the sign that a concurrent bump is going on and you might want to coordinate in that case. If the other work gets merged in, call the script/skill again to update the release notes accordingly.


#### Bump to latest main mode

The main reason you'd merge work to Ark without a parallel Positron-side bump PR is when the work doesn't have user-visible changes and shouldn't affect the frontend. It's still a good idea to update the frontend-side submodule regularly, which you can do by supplying "main" instead of an Ark PR number.

In this mode, the Positron bump PR isn't tethered to an Ark PR or branch, it tracks the latest Ark commit on main. There can be only one "Bump to latest main" PR opened at any time. When you invoke the script again and a PR is already open, it checks the Ark repo for an update, and bumps the submodule commit in the open bump PR if needed.

If two colleagues try to bump to latest concurrently, the second bump will alert you that another PR is already open and ask you to confirm whether you want to refresh the bump even though it's not your PR.

The script scans all commits and linked PRs to generate a description that includes the Closes section, commits section, as well as release notes. There shouldn't be any release notes in this mode (the preferred workflow is to generate them with a tracked PR bump), but they are checked and included just in case.
