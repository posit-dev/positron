# Positron E2E Test Guide

This document provides guidelines and setup instructions for effectively running and managing end-to-end tests in the Positron project.

## Table of Contents

- [Test Structure Overview](#test-structure-overview)
- [Setup](#setup)
- [Dependencies](#dependencies)
- [Running Tests](#running-tests)
- [Test Project](#test-project)
- [Running Tests in Github Actions](#running-tests-in-github-actions)
- [Notes About Updating Specific Tests](#notes-about-updating-specific-tests)
- [Tests Run on PRs](#tests-run-on-prs)

## Test Structure Overview

### Test Code Location

- `test/e2e/tests`

For instance, the e2e tests for the help pane are at `test/e2e/tests/help/help.test.ts`

### Test Helpers Location

- General helpers dir: `test/automation/src`
- Positron helpers dir: `test/automation/src/positron`

For each area under test, there is typically a companion class that assists with locating and interacting with elements (similar to POM pattern). For instance, the e2e tests for the help pane are at `test/e2e/tests/help/help.test.ts`

### Test Template

An [example test](https://github.com/posit-dev/positron/blob/main/test/e2e/example.test.ts) is available to help guide you in structuring a new test.

## Setup

### Environment Variables

In order to run the tests you'll need to have two environment variables set. These are so Positron knows what R and Python versions to load. A typical place to set them on a mac is in your `.zshrc`, but you should use your environment variable setting method of choice!

Make sure you have the selected R and Python version installed that you are using for the environment variables. The easiest way is to open Positron and copy a version number you have available in the interpreter picker.

Add these to your .zshrc or the relevant configuration file for your shell:

```bash
export POSITRON_PY_VER_SEL="3.11.5"
export POSITRON_R_VER_SEL="4.2.1"
```

_Note: If you forgot to set the environment variables before running the tests, you'll need to restart your editor or shell session for the environment variables to be loaded in._

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

Before compiling the tests, make sure to install dependencies in the following directories:

```bash
npm --prefix test/automation install
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
2. Ensure the correct project (`e2e-electron` or `e2e-browser`) is selected; otherwise, no tests will populate in the Test Explorer.
3. Expand the file tree to locate the desired test.
4. Use the action buttons next to each test to:
   - **Run Test**: Executes the selected test.
   - **Debug Test**: Launches the test in debug mode.
   - **Go to Test**: Opens the test in the editor.
   - **Watch Test**: Monitors the test for changes and reruns it.

#### Running Specific Tests

- Navigate to the relevant spec file in the editor.
- Ensure the correct project is selected in the Test Explorer (you can run both `web` and `electron` tests simultaneously, but tests not tagged with `@web` won't run in a browser).
- Use the green play button next to each test to:
  - Left-click: Run the test.
  - Right-click: Access additional options (Run/Debug).

#### Command Line

Run tests directly from the CLI with these scripts:

```shell
# run entire electron test suite
npm run e2e

# run entire web test suite
npm run e2e-browser

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

## Pull Requests and Test Tags

When you create a pull request, the test runner automatically scans the PR description for test tags to determine which E2E tests to run.

- **Always-on Tests:** Tests tagged with `@critical` always run, and you can’t opt out of them.
- **Custom Tags:** If your changes affect a specific feature, you can include additional tags in the PR description to trigger relevant tests.

To add a test tag:

1. Use the format `@:tag` in your PR description (e.g., `@:help`, `@:console`).
2. Once added, a comment will appear on your PR confirming that the tag was found and parsed correctly.

From that point, all E2E tests linked to the specified tag(s) will run during the test job. For a full list of available tags, see this [file](https://github.com/posit-dev/positron/blob/main/test/e2e/helpers/test-tags.ts).

Note: You can update the tags in the PR description at any time. The PR comment will confirm the parsed tags, and the test job will use the tags present in the PR description at the time of execution.

## Running Tests in Github Actions

New tests are not complete until they run successfully across operating systems (Mac, Windows, & Ubuntu) and in [Github Actions](https://github.com/posit-dev/positron/actions/workflows/test-full-suite.yml). In Github Actions we use an Ubuntu instance to run the tests, so if you are developing your tests using a Mac or on Windows, this is an opportunity to test a different operating system. Also, you can easily run your new tests against a branch to verify them before merge. Simply pick the branch after you click on "Run Workflow". Note that you can also temporarily modify the workflow itself to get your new tests executed more quickly. To do this, skip the runs of the unit and integration tests.

### Github Actions Test Artifacts

When a run is complete, you can debug any test failures that occurred using the HTML report. This report will contain everything you need: error info, test steps, screenshot(s), trace, and logs. Note that the trace files are only present for failed cases.

## Notes About Updating Specific Tests

### Plot Tests That Use Resemblejs

In order to get the "golden screenshots" used for plot comparison is CI, you will need to temporarily uncomment the line of code marked with `capture master image in CI` or add a similar line of code for a new case. We must use CI taken snapshots because if the "golden screenshots" are taken locally, they will differ too much from the CI images to be useable with a proper threshold. You can't compare the current runtime plot against a snapshot until you have established a baseline screenshot from CI that is saved to `test/e2e/plots`.

## Tests run on PRs

If you think your test should be run when PRs are created, [tag the test with @critical](https://playwright.dev/docs/test-annotations#tag-tests). The existing @critical cases were selected to give good overall coverage while keeping the overall execution time down to ten minutes or less. If your new test functionality covers a part of the application that no other tests cover, it is probably a good idea to include it in the @critical set.
