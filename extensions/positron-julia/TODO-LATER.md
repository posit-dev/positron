# Julia Extension - Deferred Improvements

This document tracks improvements and features that are out of scope for the initial implementation but should be addressed in future work.

## Console Completions via Jupyter Protocol

**Current State**: Runtime completions in the console are implemented using a workaround that executes Julia code via `execute_request` to call `REPLCompletions.completions()` and parses the output.

**Ideal Solution**: Implement proper Jupyter `complete_request` / `complete_reply` message handling in positron-supervisor. This would:
- Be more efficient (no code execution overhead)
- Follow the standard Jupyter protocol
- Enable richer completion metadata (types, documentation)

**Required Changes**:
1. Add `CompleteRequest` and `CompleteReply` message types to `positron-supervisor/src/jupyter/JupyterMessageType.ts`
2. Implement the request/reply handling in `KallichoreSession.ts`
3. Expose a `getCompletions()` method on the Positron runtime API
4. Update positron-julia to use the new API instead of the execute_request workaround

**Reference**: IJulia handles `complete_request` in `handlers.jl` using `Base.REPL.REPLCompletions.completions()`.

## Language Server Improvements

### Connect LanguageServer.jl to Running Session
Currently, the language server runs in a separate Julia process and doesn't have access to runtime state. julia-vscode has a mechanism to connect the language server to the REPL process for runtime-aware completions.

**Reference**: julia-vscode uses a custom RPC mechanism (`repl/getcompletions`) to query the running Julia process.

### Symbol Indexing for Workspace
LanguageServer.jl can index the workspace for better go-to-definition and find-references support. This requires proper configuration of the environment path and project detection.

## Debug Adapter Protocol (DAP)

Julia has a debug adapter (`Debugger.jl` / `DebugAdapter.jl`) that could be integrated for breakpoint debugging support.

## Workspace/Project Detection

- Detect `Project.toml` / `Manifest.toml` and activate the appropriate environment
- Support for Julia environments in the status bar

## Formatting

- Integrate `JuliaFormatter.jl` for code formatting
- Expose as VS Code format document/selection commands

## Testing

- Integration with Julia's `Test` stdlib
- Test discovery and execution in the Test Explorer
