# End-to-End Testing Context

This prompt provides context for working with Positron's end-to-end test suite.

## Test Architecture

Positron uses Playwright for end-to-end testing with a custom test setup that supports both Electron app and web browser testing modes.

### Test Projects

- **e2e-electron**: Tests the Electron desktop application (default)
- **e2e-browser**: Tests the web version of Positron
- **e2e-windows**: Windows-specific tests
- **e2e-macOS-ci**: macOS CI-specific tests

### Test Organization

Tests are organized in `test/e2e/tests/` by functional area:

- `apps/` - Application integration tests
- `autocomplete/` - Code completion tests
- `code-actions/` - Code actions and refactoring tests
- `connections/` - Database and data source connection tests
- `console/` - Console/REPL functionality tests
- `data-explorer/` - Data viewer and explorer tests
- `debug/` - Debugging functionality tests
- `editor/` - Text editor functionality tests
- `extensions/` - Extension system tests
- `help/` - Help system tests
- `interpreters/` - Language interpreter management tests
- `layouts/` - UI layout and workspace tests
- `notebook/` - Jupyter notebook tests
- `plots/` - Plotting and visualization tests
- `quarto/` - Quarto document tests
- `reticulate/` - R-Python integration tests
- `sessions/` - Session management tests
- `variables/` - Variable explorer tests
- `viewer/` - File and data viewer tests

## Running Tests

### Basic Commands

```bash
# Run a specific test file
npx playwright test data-explorer-python-pandas.test.ts --project e2e-electron --reporter list

# Run all data-explorer tests
npx playwright test test/e2e/tests/data-explorer/ --project e2e-electron

# Run tests with specific tags
npx playwright test --grep @tag-name

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests with debug mode
npx playwright test --debug

# Generate test report
npx playwright show-report
```

### Project Selection

- Use `--project e2e-electron` for desktop app tests (most common)
- Use `--project e2e-browser` for web version tests
- Use `--project e2e-windows` for Windows-specific tests
- Use `--project e2e-macOS-ci` for macOS CI tests

### Test Tags and Filtering

Tests use tags for filtering:
- `@:web` - Web-only tests
- `@:web-only` - Excluded from desktop tests
- `@:win` - Windows-specific tests
- `@:interpreter` - Interpreter-related tests

## Test Development

### Test Structure

Tests extend the custom `PositronTestCase` which provides:
- Application startup/shutdown handling
- Custom fixtures for Positron-specific UI elements
- Helper methods for common operations

### Common Test Patterns

```typescript
import { expect } from '@playwright/test';
import { PositronTestCase } from '../_test.setup';

PositronTestCase.test('Test description', async ({ page, app }) => {
    // Test implementation
    await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');
    // Use app.workbench for UI interactions
    // Use page for low-level browser operations
});
```

### Debugging Tests

1. **Run in headed mode**: `--headed` flag shows the browser
2. **Use debug mode**: `--debug` flag pauses execution for inspection
3. **Add breakpoints**: Use `await page.pause()` in test code
4. **Check test artifacts**: Screenshots and traces saved to `test-results/`
5. **View HTML report**: `npx playwright show-report`

## Test Configuration

- **Timeout**: 2 minutes per test
- **Expect timeout**: 15 seconds for assertions
- **Workers**: 3 parallel workers
- **Retries**: 1 retry in CI, 0 locally
- **Headless**: false (shows browser by default)

## CI/CD Integration

Tests run automatically in GitHub Actions with:
- JUnit XML output for test reporting
- HTML reports for failure analysis
- GitHub Actions annotations for failed tests
- Currents.dev integration for test analytics (when enabled)

## Troubleshooting

### Common Issues

1. **Timeout errors**: Increase timeout or use better waits
2. **Element not found**: Use proper selectors and wait strategies
3. **Flaky tests**: Add proper synchronization points
4. **Session conflicts**: Ensure proper test isolation
5. **BUILD environment variable**: If the `BUILD` environment variable is set, it must be unset for Playwright tests to work properly. Use `unset BUILD` before running tests.

### Debug Commands

```bash
# Check test configuration
npx playwright test --list

# Run with verbose output
npx playwright test --reporter=verbose

# Run single test with full output
npx playwright test specific-test.test.ts --reporter=line
```

## Test Maintenance

- Tests should be independent and not rely on order
- Use descriptive test names and organize by functionality
- Clean up after tests (close sessions, reset state)
- Keep tests focused on single functionality
- Use page object models for complex UI interactions