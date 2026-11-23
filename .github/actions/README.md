# Composite actions

Most of Positron's test lanes run in the private repository `posit-dev/positron-builds`. Those lanes check out this repository and use some of the actions here. A search of this repository for callers does not find those uses.

Do not delete an action in this list because it has no caller here:

- `e2e-failure-analyzer`
- `gen-report-dir`
- `save-build-caches`
- `setup-build-env`
- `setup-build-env-windows`
- `setup-e2e-test-dependencies`
- `setup-jupyter-docker`
- `setup-r-windows`
- `setup-release-screenshot-runtimes`
- `setup-workbench-docker`
- `setup-xvfb`
- `upload-report-to-s3`

These actions also have callers in this repository, and `posit-dev/positron-builds` uses them too: `download-binaries`, `e2e-tag-listing-setup`, `join-tailnet`, `restore-build-caches`.

To check an action, search the workflows of `posit-dev/positron-builds` for `.github/actions/<name>`.

Some actions here come from upstream VS Code and have no caller in either repository (for example `detect-changes` and `save-node-modules`). Leave them in place: deleting them causes a conflict at each upstream merge.
