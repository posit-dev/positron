# Positron E2E Test Guide

This document provides guidelines and setup instructions for effectively running and managing end-to-end tests in the Positron project.

## Table of Contents

- [Test Structure Overview](#test-structure-overview)
- [Setup](#setup)
- [Dependencies](#dependencies)
- [Running Tests](#running-tests)
- [Test Project](#test-project)
- [Remote WSL Tests](#remote-wsl-tests)
- [Pull Requests and Test Tags](#pull-requests-and-test-tags)
- [Running Tests in Github Actions](#running-tests-in-github-actions)
- [Notes About Updating Specific Tests](#notes-about-updating-specific-tests)

## Test Structure Overview

### Test Code Location

All Positron end-to-end (E2E) test code resides in the `test/e2e` directory. For each area under test, there is typically a corresponding Page Object Model (POM) class to assist with locating and interacting with page elements.

```plaintext
test/
└── e2e/
    ├── infra/   <-- contains the driver, browser, electron, test runner, etc. files
    ├── pages/   <-- contains all the Positron POMs
    └── tests/   <-- contains all the tests, organized by area
```

### Test Template

An [example test](https://github.com/posit-dev/positron/blob/main/test/e2e/tests/example.test.ts) is available to help guide you in structuring a new test.

## Setup

### Environment Variables

In order to run the tests you'll need to have four environment variables set. These are so Positron knows what R and Python versions to load. Copy `.env.e2e.example` to `.env.e2e` in the root of the repo and update the values:

```bash
POSITRON_PY_VER_SEL=3.11.5
POSITRON_R_VER_SEL=4.2.1
POSITRON_PY_ALT_VER_SEL=3.13.0 (Pyenv)
POSITRON_R_ALT_VER_SEL=4.4.2
```

Make sure you have the selected R and Python version installed that you are using for the environment variables.

_Note: If you are using Pyenv for your alternate Python interpreter, please add ` (Pyenv)` to the variable value._

## Dependencies

Below are the different package and environment dependencies you'll need to install that are used in the smoke tests.

### Python Dependencies

```bash
curl https://raw.githubusercontent.com/posit-dev/qa-example-content/main/requirements.txt --output requirements.txt
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install ipykernel
```

### R Dependencies

```bash
curl https://raw.githubusercontent.com/posit-dev/qa-example-content/main/DESCRIPTION --output DESCRIPTION
Rscript -e "pak::local_install_dev_deps(ask = FALSE)"
```

### Graphviz

Graphviz is external software that has a Python package to render graphs. Install for your OS:

- **Debian/Ubuntu** - `apt install graphviz`
- **Fedora** - `dnf install graphviz`
- **Windows** - `choco install graphviz`
- **Mac** - `brew install graphviz`

### Conda

Some smoke tests use Conda environments. Install a lightweight version of Conda:

- [miniforge](https://github.com/conda-forge/miniforge/tree/main?tab=readme-ov-file#install) (On Mac, you can `brew install miniforge`. The equivalent installer may also be available via package managers on Linux and Windows.)
- [miniconda](https://docs.anaconda.com/miniconda/#quick-command-line-install) (On Mac, you can `brew install miniconda`. The equivalent installer may also be available via package managers on Linux and Windows.)

### Resemblejs

Make sure that you have followed the [Machine Setup](https://connect.posit.it/positron-wiki/machine-setup.html) instructions so that you can be sure you are set up to build resemblejs (which depends on node-canvas).

### Test Dependencies

Several tests use [QA Content Examples](https://github.com/posit-dev/qa-example-content). You will need to install the dependencies for those projects. A few current tests also use additional packages. You can look in the [positron-full-test.yml](https://github.com/posit-dev/positron/blob/39a01b71064e2ef3ef5822c95691a034b7e0194f/.github/workflows/positron-full-test.yml) Github action for the full list.

## Running Tests

### Install

Before compiling the tests, make sure to install dependencies:

```bash
npm --prefix test/e2e install
```

### Build

The tests are written in TypeScript, but unlike the main Positron code, these files aren’t automatically transpiled by the build daemons. To run the tests, you’ll need to start the build watcher:

```bash
npm run --prefix test/e2e watch
```

_You may see errors in test files before you run this builder step once, as it's looking for types in the not-yet-existing build artifacts._

### Launch Tests

#### Playwright Test Extension

We use Playwright as the test framework for end-to-end tests in Positron. Make sure to install the [Playwright Test](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) extension for VS Code to explore and debug tests effectively. Also, don't be afraid to use their [Help Docs](https://playwright.dev/docs/writing-tests) - they are a great source of information!

#### Test Explorer

1. Open the **Testing** extension.
2. Ensure the correct project is selected; otherwise, no tests will populate in the Test Explorer.
   - `e2e-electron`: Standard Electron app testing
   - `e2e-chromium`: Chromium browser testing with managed server
   - `e2e-server`: Browser testing with external Positron server
   - `e2e-workbench`: Browser testing against container containing both Positron and Workbench
3. Expand the file tree to locate the desired test.
4. Use the action buttons next to each test to:
   - **Run Test**: Executes the selected test.
   - **Debug Test**: Launches the test in debug mode.
   - **Go to Test**: Opens the test in the editor.
   - **Watch Test**: Monitors the test for changes and reruns it.

#### Running Specific Tests

- Navigate to the relevant spec file in the editor.
- Ensure the correct project is selected in the Test Explorer (you can run both `web` and `electron` tests simultaneously, but tests not tagged with `@:web` won't run in a browser).
- Use the green play button next to each test to:
  - Left-click: Run the test.
  - Right-click: Access additional options (Run/Debug).

#### Command Line

Run tests directly from the CLI with these scripts:

```shell
# run entire electron test suite
npm run e2e

# run entire web test suite
npm run e2e-chromium

# run entire pr test suite
npm run e2e-pr

# re-run only failed tests from last run
npm run e2e-failed

# craft your own custom command
npx playwright test <testName> --project e2e-electron --grep <someTag> --workers 3
```

#### UI Mode

Launch Playwright’s UI mode for a graphical view of test traces, making debugging easier for complex interactions:

```shell
npm run e2e-ui
```

#### Target a Positron Build

To test against a specific build, set the BUILD environment variable:

```bash
# Run all tests
BUILD=/Applications/Positron.app npm run e2e

# Run PR-tagged tests
BUILD=/Applications/Positron.app npm run e2e-pr
```

**Note:** During the setup phase, the script will automatically detect and display the version of Positron being tested. This helps verify that the correct build is being used.

## Test Project

Before any of the tests start executing the test framework clones down the [QA Content Examples](https://github.com/posit-dev/qa-example-content) repo. This repo contains R and Python files that are run by the automated tests and also includes data files (such as Excel, SQLite, & parquet) that support the test scripts. If you make additions to QA Content Examples for a test, please be sure that the data files are free to use in a public repository.

For Python, add any package requirements to the `requirements.txt` file in the root of the [QA Content Examples](https://github.com/posit-dev/qa-example-content) repo. We generally do NOT pin them to a specific version, as test can be run against different versions of python and conflicts could arise. If this becomes a problem, we can revisit this mechanism.

For R, add any package requirements to the "imports" section of the `DESCRIPTION` file in the root of the [QA Content Examples](https://github.com/posit-dev/qa-example-content) repo.

## Remote WSL Tests

The `e2e-remote-wsl` project (tag `@:remote-wsl`, tests under `test/e2e/tests/remote-wsl/`) exercises connecting Positron to a [WSL](https://learn.microsoft.com/windows/wsl/) distro via the `open-remote-wsl` extension. These tests run **only on Windows** and are excluded from the normal suites.

### Prerequisites

- Windows with WSL installed and at least one glibc-based distro registered (e.g. `Ubuntu`). The REH (remote extension host) is a glibc `linux-x64` binary, so musl distros (Alpine) won't work. Pick the distro with `POSITRON_WSL_DISTRO` (defaults to `Ubuntu`).
- A Positron REH tarball reachable from inside the distro. A dev build's `product.json` has no `commit`/`version`, so the extension's default download URL (a CDN template with `${version}`/`${commit}`) can't be resolved. Provide a local tarball instead and point the extension at it with `POSITRON_WSL_SERVER_DOWNLOAD_URL`.
- For the Python and R tests, the distro must have Python and R interpreters installed and discoverable by Positron. The session picker matches the version in `POSITRON_PY_VER_SEL` / `POSITRON_R_VER_SEL` (bare version strings, e.g. `3.12.11`, `4.4.3`); since the in-distro interpreters differ from the local Windows ones, override them with `POSITRON_PY_WSL_VER_SEL` / `POSITRON_R_WSL_VER_SEL`. When unset, the local selectors are used as-is.

### Build a local REH

```bash
# From the repo root. Produces ../vscode-reh-linux-x64
npm run gulp vscode-reh-linux-x64

# Package it so `bin/positron-server` lands at the tarball root (the extension extracts with
# --strip-components 1, stripping the top-level vscode-reh-linux-x64/ directory).
tar czf positron-reh-linux-x64.tar.gz -C .. vscode-reh-linux-x64
```

### Run

```bash
# Dev build (no BUILD). The file:// URL is read from inside the distro via /mnt/c.
POSITRON_WSL_DISTRO=Ubuntu \
POSITRON_WSL_SERVER_DOWNLOAD_URL=file:///mnt/c/path/to/positron-reh-linux-x64.tar.gz \
POSITRON_PY_WSL_VER_SEL=3.12.11 \
POSITRON_R_WSL_VER_SEL=4.4.3 \
npx playwright test --project e2e-remote-wsl --workers=1
```

The suite connects to the distro and waits for the `WSL: <distro>` remote indicator, then: runs `uname` in a terminal to confirm the workbench is executing inside Linux; starts a Python session and evaluates code, checking the result in the console and Variables pane; and does the same for R.

> [!NOTE]
> CI for this project (a Windows runner that provisions WSL + the REH) is not yet wired up; it is planned as a follow-up.

## Pull Requests and Test Tags

### Test Tag Rules

When creating a pull request, the test runner automatically scans the PR description for test tags to determine which E2E tests to run.

- **Always-on Tests:** Tests tagged with `@:critical` always run, and you can’t opt out of them.
- **Custom Tags:** If your changes affect a specific feature, you can include additional tags in the PR description to trigger relevant tests.

### How to Add a Test Tag

1. Use the format `@:tag` anywhere in your PR description (e.g., `@:help`, `@:console`).
2. Once added, a comment will appear on your PR confirming that the tag was found and parsed correctly.

> [!NOTE]
> **Add tags before the `pr-tags` job starts**. If you update tags _after_ opening the PR, push a new commit or restart the jobs to apply the changes. The PR comment will confirm the detected tags, and tests will run based on the tags present at execution time.
> For a full list of available tags, see this [file](https://github.com/posit-dev/positron/blob/main/test/e2e/infra/test-runner/test-tags.ts).

### Automatic Tags (from changed files)

In addition to scanning your PR description, the `pr-tags` job derives tags from the files your PR changes, so the right suites run even if you forget to tag them. Derived tags are **added to** (never replace) the tags you write, and `@:critical` always runs.

- **Source / extension changes** map to feature tags via [`.github/workflows/e2e-tag-paths-map.json`](https://github.com/posit-dev/positron/blob/main/.github/workflows/e2e-tag-paths-map.json) (for example, a change under `contrib/positronConsole/` adds `@:console`). Test-file changes are not auto-tagged -- tag those PRs yourself (they are almost always deliberate test authoring).
- **Opt out:** add `@:no-auto-tags` to the PR description to disable this derivation for the PR (the `@:critical` floor still applies).
- **Unmapped dirs:** if your PR touches a Positron dir with no entry in the map, the E2E Tests comment will note it so you (or a maintainer) can add a mapping.

> [!NOTE]
> The description scan matches the literal `@:tag` text **anywhere** in the body, including prose and code spans. Writing something like `@:win` or `@:web` in a sentence will enable those runs. If a tag you didn't intend shows up, check your description for a stray mention.

### Running Windows and Browser Tests

By default, only Linux E2E tests run. If you need to include additional environments:

- Add `@:win` to your PR description to run tests on Windows. (Note: Windows tests take longer to complete.)
- Add `@:web` to run browser-based tests.

## Running Tests in Github Actions

New tests are not complete until they run successfully across operating systems (Mac, Windows, & Ubuntu) and in [Github Actions](https://github.com/posit-dev/positron/actions/workflows/test-full-suite.yml). In Github Actions we use an Ubuntu instance to run the tests, so if you are developing your tests using a Mac or on Windows, this is an opportunity to test a different operating system. Also, you can easily run your new tests against a branch to verify them before merge. Simply pick the branch after you click on "Run Workflow". Note that you can also temporarily modify the workflow itself to get your new tests executed more quickly. To do this, skip the runs of the unit and integration tests.

### Github Actions Test Artifacts

When a run is complete, you can debug any test failures that occurred using the HTML report. This report will contain everything you need: error info, test steps, screenshot(s), trace, and logs. Note that the trace files are only present for failed cases.

## Notes About Updating Specific Tests

### Plot Tests That Use Resemblejs

In order to get the "golden screenshots" used for plot comparison is CI, you will need to temporarily uncomment the line of code marked with `capture master image in CI` or add a similar line of code for a new case. We must use CI taken snapshots because if the "golden screenshots" are taken locally, they will differ too much from the CI images to be useable with a proper threshold. You can't compare the current runtime plot against a snapshot until you have established a baseline screenshot from CI that is saved to `test/e2e/plots`.

### Critical Tests

If your test should run on all PRs, tag it with `@:critical`. Existing `@:critical` tests balance coverage and execution time (~15 min). If your test covers an untested area, consider adding it to this set. When in doubt, ask your friendly QA team.
