# E2E Test Files

Content the Positron e2e tests open as their workspace. Merged in from the former
`qa-example-content` repo; the test harness copies this directory into a temp workspace
and git-initializes it before the suite runs (see
`test/e2e/infra/test-runner/utils.ts`).

## Contents

* `data-files/` - Example data files (csv, parquet, sqlite, etc.).
* `static-test-data-files/` - Small fixed data files referenced by specific tests.
* `utilities/` - Utilities used to create test data.
* `workspaces/` - Example workspaces/projects opened by tests.

## Dependencies

Two dependency files in this directory define the packages the workspaces need:

* `requirements.txt` - Python packages
  - `pip install -r requirements.txt`

* `DESCRIPTION` - R packages
  - `Rscript -e "pak::local_install_dev_deps(root = '.', ask = FALSE)"`
