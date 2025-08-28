# Testing

## Workflow

Run this at the repository root to launch extension tests:

```sh
npm run test-extension -- -l positron-r
```


## API

Besides Mocha (see below), we provide a "Test Kit" with:

- Helpers to manage synchronisation of effects.

  - It's not always possible to deterministically wait for an effect. For instance, the timing of testing the effect of a notification to open an editor via RStudio API can be tricky. The RStudio API call is like a fire-and-forget event and you're only testing that an editor will _eventually_ be opened on the frontend side. For these cases you can use `pollForSuccess()`, which will retry an assertion until it passes (stops throwing assertion errors).

  - `assertSelectedEditor()` is a wrapper around `pollForSuccess()` that checks an editor is getting selected.

  - `retryRm()` to try deleting a file or folder until success. Useful on Windows as you might have to wait until the file is effectively released by some component (e.g. a text document you just closed).

- Helpers to deal with temporary resources like R sessions and temporary files, and cleaning up once a test has run.

  - `startR()` creates and returns an `RSession`, along with a disposable to delete it at the end of a test or suite. Since there is an overhead to starting and cleaning a session, we recommend having one session per file, started in `suiteSetup()` and cleaned up in `suiteTeardown()`.

  - `openTextDocument()` that returns a document and a disposable to close it. See also `closeAllEditors()` to ensure all editors you might have opened are closed at the end of a test.

  - `makeTempDir()` returns a temporary directory path and a disposable to clean it up.

- The lifecycle of temporary resources is managed with the disposable pattern and we provide tools to help deal with disposables:

  - `toDisposable()` to create a disposable from a closure.

  - `disposeAll()` to dispose of an array of disposables.

  - `withDisposables()` calls a closure with an array of disposables that are automatically disposed on exit, even in case of error.

- Helpers to manage the VS Code UI.

The test kit can be imported in your test files with:

```ts
import * as testKit from './kit';
```


## Infrastructure

The extension tests are located in `src/test/`. They are executed via:

- `vscode-test`, a binary in the provided by the `test-cli` node module (https://github.com/Microsoft/vscode-test-cli).

- The Mocha testing framework (https://mochajs.org/). It's configured to use the Test-Driven Development (TDD) UI, see https://mochajs.org/#interfaces.

These frameworks are configured in the [.vscode-test.js](https://github.com/posit-dev/positron/blob/main/.vscode-test.js) file in the repository root, which the `test-extension` runner maps to.


## Testing specific files during development

Until we have something more structured, you can edit the glob in `.vscode-test.js` to include only the files you're interested in, e.g. at https://github.com/posit-dev/positron/blob/4894819e/.vscode-test.js#L136.


# Debugging

We have a `launch.json` configuration called "positron-r extension tests" that launches a debugger process of type "extension host". This will run the test runner configured in the [`src/test/index.ts`](https://github.com/posit-dev/positron/blob/main/extensions/positron-r/src/test/index.ts) file (which is not used during normal testing, only during debugging).

This launch configuration executes the test with a new instance of the _currently running process_. This means it will launch VS Code if you have the Positron project opened in VS Code, or release Positron if the project is opened with release Positron, etc. Consequently, you must run this debug configuration with a version of Positron that is sufficiently recent to run your tests. If the tests depend on the dev version of Positron, you'll first need to launch an instance of dev Positron, then launch the debug process for extension tests from that instance.


## Debugging specific files

Since the debug process runs tests via `src/test/index.ts` (rather than the `.vscode-test.js` file in the repository root), you'll need to modify the glob in that file to focus the tests on specific files.
