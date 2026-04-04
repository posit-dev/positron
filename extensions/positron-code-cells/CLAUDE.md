# Positron Code Cells

Code cell detection, folding, and execution for Python and R scripts in Positron.

## Testing

All tests currently require the extension host (they import `vscode` for editor and document APIs):

```bash
npm run test-extension -- -l positron-code-cells
```

Tests cover: cell parsing, folding regions, code lenses, decorations, cell manager, and context tracking. They take 20-30 seconds due to Electron startup.

### Adding a new test

If your test needs `vscode.*` APIs (editor, document, workspace): create a `.test.ts` file using `suite`/`test`/`assert` (Mocha).

If your test is pure logic (parsing, string manipulation): create a `.vitest.ts` file using `describe`/`it`/`expect`. This runs in ~1 second without Electron. No code cell tests use Vitest yet, but the infrastructure supports it.

### Running a single test

```bash
npm run test-extension -- -l positron-code-cells --grep 'test name'
```
