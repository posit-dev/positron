# E2E Testing

For comprehensive e2e test guidance, use the `author-e2e-tests` skill which provides:
- Test file structure and templates
- Available fixtures (`python`, `r`, `sessions`, `executeCode`, etc.)
- Page object documentation (`app.workbench.*`), with guidance on how to look up exact method signatures directly from `test/e2e/pages/*.ts`
- Assertion and waiting patterns
- Common mistakes to avoid

## Quick Commands

```bash
# Run specific test
npx playwright test <test>.test.ts --project e2e-electron

# Run all tests in a category
npx playwright test test/e2e/tests/<category>/

# Run with debugging
npx playwright test --debug

# Run in headed mode
npx playwright test --headed

# Show report
npx playwright show-report
```

## Test Projects

- **e2e-electron**: Desktop Electron app (default)
- **e2e-browser**: Web browser tests
- **e2e-windows**: Windows-specific tests
- **e2e-macOS-ci**: macOS CI tests

## Test Configuration

- **Timeout**: 2 minutes per test
- **Expect timeout**: 15 seconds for assertions
- **Workers**: 3 parallel workers
- **Retries**: 1 retry in CI, 0 locally

## Troubleshooting

If the `BUILD` environment variable is set, unset it before running tests:
```bash
unset BUILD
```

**`Process failed to launch!` when running `--project e2e-electron`.** Look past that
line to the call log; if it says:

```
[pid=NNNN][err] .../Positron.app/Contents/MacOS/Positron: bad option: --remote-debugging-port=0
```

then `ELECTRON_RUN_AS_NODE=1` is set in your shell. `<binary>: bad option:` is Node's
arg-parser error, not Electron's -- the variable makes any Electron binary behave as plain
Node, which rejects Electron's flags. The `kill EPERM` that usually follows is just
Playwright trying to kill a process that has already exited, and is not the cause.

This bites terminals launched from *inside* the IDE, including an agent session, because
the extension host exports it. An ordinary terminal does not inherit it. Run with the
variables dropped for that command rather than editing your profile:

```bash
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE \
  npx playwright test --project e2e-electron <test>
```

To reproduce and debug a CI failure locally using the actual CI image, see [`.devcontainer/ci-arm/README.md`](../../.devcontainer/ci-arm/README.md).
