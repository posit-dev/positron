# Testing

## Workflow

Run this at the repository root to launch extension tests:

```sh
npm run test-extension -- -l positron-r
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
