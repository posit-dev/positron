# End-to-End Testing Context

For comprehensive e2e test guidance, use the `positron-e2e-tests` skill which provides:
- Test file structure and templates
- Available fixtures (`python`, `r`, `sessions`, `executeCode`, etc.)
- Page object documentation (`app.workbench.*`)
- Assertion and waiting patterns
- 26 common mistakes to avoid

## Quick Commands

```bash
# Run specific test
npx playwright test <test>.test.ts --project e2e-electron --reporter list

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
