# Positron Assistant

AI/LLM assistant integration for Positron.

## Testing

This extension has two types of tests:

**Vitest tests** (`.vitest.ts`) -- pure logic, no extension host needed:
```bash
npx vitest run extensions/positron-assistant/src/test/
```
These test provider logic, fetch utilities, and notebook context filtering. They run in ~1 second.

**Extension host tests** (`.test.ts`) -- require VS Code APIs:
```bash
npm run test-extension -- -l positron-assistant
```
These test features that need `vscode` or `positron` APIs (model resolution, tool execution, configuration). They take 20-30 seconds due to Electron startup.

### Adding a new test

Ask yourself: does my test need `vscode.*` or `positron.*` APIs?

- **No** -> create a `.vitest.ts` file. Use `describe`/`it`/`expect`. See `snowflake.vitest.ts` for an example.
- **Yes, but only for enums/types** -> create a `.vitest.ts` file. The `positron` module is stubbed in Vitest (see `src/vs/base/test/common/positron-stub.ts`). See `awsBedrock.vitest.ts` for an example.
- **Yes, genuinely** -> create a `.test.ts` file. Use `suite`/`test`/`assert` (Mocha). See `openai.test.ts` for an example.

### Running a single test

```bash
# Vitest (fast)
npx vitest run extensions/positron-assistant/src/test/snowflake.vitest.ts

# Extension host (slow)
npm run test-extension -- -l positron-assistant --grep 'test name'
```
