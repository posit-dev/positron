# VS Code Smoke Test

Make sure you are on **Node v12.x**.

## Quick Overview

```bash
# Build extensions in the VS Code repo (if needed)
yarn && yarn compile

# Dev (Electron)
yarn smoketest

# Dev (Web - Must be run on distro)
yarn smoketest --web --browser [chromium|webkit]

# Build (Electron)
yarn smoketest --build <path to latest version>
example: yarn smoketest --build /Applications/Visual\ Studio\ Code\ -\ Insiders.app

# Build (Web - read instructions below)
yarn smoketest --build <path to server web build (ends in -web)> --web --browser [chromium|webkit]

# Remote (Electron)
yarn smoketest --build <path to latest version> --remote
```

\* This step is necessary only when running without `--build` and OSS doesn't already exist in the `.build/electron` directory.

### Running for a release (Endgame)

You must always run the smoketest version that matches the release you are testing. So, if you want to run the smoketest for a release build (e.g. `release/1.22`), you need to check out that version of the smoke tests too:

```bash
git fetch
git checkout release/1.22
yarn && yarn compile
yarn --cwd test/smoke
```

#### Web

There is no support for testing an old version to a new one yet.
Instead, simply configure the `--build` command line argument to point to the absolute path of the extracted server web build folder (e.g. `<rest of path here>/vscode-server-darwin-x64-web` for macOS). The server web build is available from the builds page (see previous subsection).

**macOS**: if you have downloaded the server with web bits, make sure to run the following command before unzipping it to avoid security issues on startup:

```bash
xattr -d com.apple.quarantine <path to server with web folder zip>
```

**Note**: make sure to point to the server that includes the client bits!

### Debug

- `--verbose` logs all the low level driver calls made to Code;
- `-f PATTERN` (alias `-g PATTERN`) filters the tests to be run. You can also use pretty much any mocha argument;
- `--headless` will run playwright in headless mode when `--web` is used.

**Note**: you can enable verbose logging of playwright library by setting a `DEBUG` environment variable before running the tests (<https://playwright.dev/docs/debug#verbose-api-logs>), for example to `pw:browser`.

### Develop

```bash
cd test/smoke
yarn watch
```

## Troubleshooting

### Error: Could not get a unique tmp filename, max tries reached

On Windows, check for the folder `C:\Users\<username>\AppData\Local\Temp\t`. If this folder exists, the `tmp` module can't run properly, resulting in the error above. In this case, delete the `t` folder.

## Pitfalls

- Beware of workbench **state**. The tests within a single suite will share the same state.

- Beware of **singletons**. This evil can, and will, manifest itself under the form of FS paths, TCP ports, IPC handles. Whenever writing a test, or setting up more smoke test architecture, make sure it can run simultaneously with any other tests and even itself. All test suites should be able to run many times in parallel.

- Beware of **focus**. **Never** depend on DOM elements having focus using `.focused` classes or `:focus` pseudo-classes, since they will lose that state as soon as another window appears on top of the running VS Code window. A safe approach which avoids this problem is to use the `waitForActiveElement` API. Many tests use this whenever they need to wait for a specific element to _have focus_.

- Beware of **timing**. You need to read from or write to the DOM... but is it the right time to do that? Can you 100% guarantee that `input` box will be visible at that point in time? Or are you just hoping that it will be so? Hope is your worst enemy in UI tests. Example: just because you triggered Quick Access with `F1`, it doesn't mean that it's open and you can just start typing; you must first wait for the input element to be in the DOM as well as be the current active element.

- Beware of **waiting**. **Never** wait longer than a couple of seconds for anything, unless it's justified. Think of it as a human using Code. Would a human take 10 minutes to run through the Search viewlet smoke test? Then, the computer should even be faster. **Don't** use `setTimeout` just because. Think about what you should wait for in the DOM to be ready and wait for that instead.
<!-- Start Positron -->

# Notes on smoke tests in Positron

The following are a series of notes related to running smoke tests in Positron.

## Where?

Code for smoke tests is in the path `test/smoke` from the root of the repo

### Test scripts

The tests themselves are located at the path `test/smoke/src/areas/positron/<area>/*.test.ts`

For instance the smoke tests for the help pane are at `test/smoke/src/areas/positron/help/help.test.ts`

### Automation helpers

Typically an area being tested will have a companion class that helps manage the details of finding and interacting with the area that sits at `test/automation/src/positron`.

Again, the help pane tests have a `PositronHelp` class defined at `test/automation/src/positron/positronHelp.ts`

## Environment setup

In order to run the tests you'll need to have two environment variables set. These are so Positron knows what R and Python versions to load.

A typical place to set them on a mac is in your `.zshrc`, but you should use your environment variable setting method of choice!

**~/.zshrc**

```bash
export POSITRON_PY_VER_SEL="3.11.5"
export POSITRON_R_VER_SEL="4.2.1"
```

Make sure you actually have the version you chose installed. Easiest way is to open Positron and just copy a version number you have available in the picker.

_Note: If you forgot to do this before trying to run the tests, you'll need to restart VSCode or whatever editor you're using before they will take effect._

## Build step

The tests are written in typescript, but unlike the main Positron typescript, the files are not transpiled by the build daemons. So when running tests you'll need to navigate into the smoke tests location and run the build watcher:

```bash
cd test/smoke
yarn watch
```

_You may see errors in test files before you run this builder step once, as it's looking for types in the not-yet-existing build artifacts._

## Running tests

Once you have the build watcher running you can run the smoke tests with the debug action `Launch Smoke Test`. (It's near the bottom of the debug dropdown.)

### Only running a subset of tests

It takes a long time to run all the tests. To only run specific tests you can replace the `it()` function from your test script with `it.only()`. If the runner detects `it.only()`s in the tests it will _only_ run those blocks.

_Note: Don't forget to remove the `.only()`s when you're done!_

## Local debugging

### Breakpoints

Unfortunately setting breakpoints on the typescript source files for tests doesn't work, at least not like it does for the rest of Positron.

_We're not totally sure why the generated map files aren't used, but this may be fixable._

There are two ways to add breakpoints:

- Set the breakpoint in the built javascript.
  - Go into the build artifact `test/smoke/src/areas/positron/<area>/*.test.ts`
    - Note the replacement of the `src` with `out`.
    - Here's the path to the help test built js `test/smoke/out/areas/positron/help/help.test.js`
  - Set a breakpoint in the desired place in this artifact.
- Add a `debugger;` statement to your script
  - If you simply place the line `debugger;` into your test code it will survive the build step.
  - (Don't forget to delete after you've finished debugging!)

### Devtools

The controlled instance of Positron doesn't allow you to manually open the developer tools like you typically might with the command `workbench.action.toggleDevTools`.

The way around this is to invoke the command from your test script itself.

```ts
// This line will most likely be at the top of your test function already
const app = this.app as Application

...

await app.workbench.quickaccess.runCommand('workbench.action.toggleDevTools');`
```

(Again, don't forget to remove this line after you've finished debugging!)

<!-- End Positron -->
