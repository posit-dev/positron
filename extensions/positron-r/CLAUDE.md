# Positron R Extension

R language support for Positron, including debugging, LSP, and runtime management.

## Testing

This extension has two types of tests:

**Vitest tests** (`.vitest.ts`) -- pure logic, no extension host needed:
```bash
npx vitest run extensions/positron-r/src/test/
```
These test hyperlink matching and R version file parsing. They run in ~1 second.

**Extension host tests** (`.test.ts`) -- require VS Code/Positron APIs or a running R session:
```bash
npm run test-extension -- -l positron-r
```
These test the debugger, LSP, statement ranges, indentation, and R session management. They require Electron and may need R installed. Tests take 30+ seconds.

### Adding a new test

Ask yourself: does my test need `vscode.*`, `positron.*` APIs, or a running R session?

- **No** -> create a `.vitest.ts` file. Use `describe`/`it`/`expect`. See `hyperlink.vitest.ts` for an example.
- **Yes** -> create a `.test.ts` file. Import `./mocha-setup` for extension host configuration. Use `suite`/`test`/`assert` (Mocha). See `debugger.test.ts` for an example.

### Running a single test

```bash
# Vitest (fast)
npx vitest run extensions/positron-r/src/test/hyperlink.vitest.ts

# Extension host (slow, needs R)
npm run test-extension -- -l positron-r --grep 'test name'
```

### Troubleshooting

- **Tests timeout waiting for R**: Ensure R is installed and discoverable. Tests use `testKit.startR()` with a 30-second timeout for runtime discovery.
- **`discovery.test.ts` is skipped**: Known issue -- these tests fail randomly with npm (worked with yarn). Marked `suite.skip()`.
