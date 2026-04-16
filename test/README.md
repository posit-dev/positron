<!-- Start Positron -->
<!-- If you are seeking the original Vscode README go here: https://github.com/microsoft/vscode/tree/main/test -->

# Positron Tests

## Contents

This folder contains the various test runners for Positron. Please refer to the documentation within for how to run them:

* **Vitest tests** (`.vitest.ts`/`.vitest.tsx`): fast tests in `src/vs/`, no build daemons needed. Run with `npx vitest run`.
* `unit`: VS Code unit tests run via Mocha ([README](unit/README.md))
* `integration`: extension host tests that need the extension host running ([README](integration/browser/README.md))
* `e2e`: Playwright end-to-end tests ([README](e2e/README.md))

<!-- End Positron -->
# VS Code Tests

## Contents

This folder contains the various test runners for VS Code. Please refer to the documentation within for how to run them:

* `unit`: our suite of unit tests ([README](unit/README.md))
* `integration`: our suite of API tests ([README](integration/browser/README.md))
* `smoke`: our suite of automated UI tests ([README](smoke/README.md))
* `sanity`: release sanity tests ([README](sanity/README.md))
