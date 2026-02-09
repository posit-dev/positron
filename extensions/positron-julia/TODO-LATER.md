# Julia Extension - Deferred Improvements

This document tracks improvements and features that are out of scope for the initial implementation but should be addressed in future work.

## Console Completions via Jupyter Protocol (BLOCKED)

**Current State**: Runtime completions are **disabled** because there's no way to silently execute code and get the result back via the Positron API.

### Problem Details

We tried to implement a VS Code `CompletionItemProvider` that supplements the LSP completions with runtime variables defined in the Julia session. The approach:

1. Register completion provider for Julia documents (including `inmemory` scheme for console)
2. On completion request, execute Julia code via `positron.runtime.executeCode()`:
   ```julia
   let
       import REPL.REPLCompletions
       code = "user_input_here"
       completions, range, should_complete = REPLCompletions.completions(code, cursor_pos)
       join([REPLCompletions.completion_text(c) for c in completions], "\n")
   end
   ```
3. Parse the result and return as VS Code completion items

### API Behavior Observed

**`RuntimeCodeExecutionMode.Silent`**:
- The code executes (we could see output if using `println`)
- BUT the return value from `executeCode()` is `{}` (empty object)
- No `text/plain` MIME type in the result
- The `onOutput` observer callback is NOT called for stdout

**`RuntimeCodeExecutionMode.Transient`**:
- The code executes
- Return value contains `{"text/plain": "\"result\\nhere\""}` ✓
- BUT the output is displayed in the console (pollutes user's view)
- Every tab completion would spam the console with Julia code results

### What We Need

**Option A: Fix Silent mode to return results**
- `RuntimeCodeExecutionMode.Silent` should still return the expression result
- It should just not display to user / not store in history
- This seems like it might be a bug or oversight in the current implementation

**Option B: Implement Jupyter `complete_request`**
- Standard Jupyter protocol has `complete_request` / `complete_reply` message types
- IJulia already handles this in `handlers.jl`
- positron-supervisor currently only has `is_complete_request`, not `complete_request`

**Required Changes for Option B**:
1. Add `CompleteRequest` and `CompleteReply` message types to `positron-supervisor/src/jupyter/JupyterMessageType.ts`
2. Add a `JupyterCompleteRequest` class similar to `IsCompleteRequest`
3. Implement request handling in `KallichoreSession.ts`
4. Expose a `getCompletions(code: string, cursorPos: number)` method on `positron.runtime` API
5. Update positron-julia to use the new API

### Files Involved
- `src/completions.ts` - The disabled completion provider (code retained for future use)
- `positron-supervisor/src/jupyter/JupyterMessageType.ts` - Missing `complete_request`
- `positron-supervisor/src/KallichoreSession.ts` - Where request handling would be added

### Reference
- IJulia handles `complete_request` in `handlers.jl` using `Base.REPL.REPLCompletions.completions()`
- Python in Positron uses Pylance (LSP) exclusively for completions, so doesn't hit this issue
- julia-vscode uses a custom RPC mechanism (`repl/getcompletions`) separate from Jupyter

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

## Data Explorer - Code Generation

### convert_to_code Implementation

**Status**: Not implemented

**Description**: Generate Julia code (or dplyr/pandas-style code) from current Data Explorer state (filters, sorts). Allows users to generate reproducible code from interactive exploration.

**Requirements**:
- Generate Julia DataFrames.jl code for filters
- Generate code for sorting operations
- Handle multiple filters with AND/OR conditions
- Generate code for column selections
- Support different code syntax preferences

**Reference**: See Python implementation in `data_explorer.py` for pattern.

**Priority**: Medium (nice-to-have feature, not core functionality)


## Data Explorer - Code Generation

### convert_to_code Implementation

**Status**: Not implemented

**Description**: Generate Julia code from Data Explorer state (filters, sorts). Allows users to generate reproducible code from interactive exploration.

**Requirements**:
- Generate Julia DataFrames.jl code for filters
- Generate code for sorting operations  
- Handle multiple filters with AND/OR
- Support column selections

**Reference**: Python implementation in data_explorer.py

**Priority**: Medium (nice-to-have, not core)


## IJulia Comm Integration

### Status: Needs Fix

**Issue**: Current comm registration doesn't match IJulia's type-based dispatch pattern.

**Error**: 
```
MethodError: no method matching register_comm(::Function, ::String)
Closest: register_comm(::IJulia.Comm, ::Any)
```

**Root Cause**: 
IJulia uses method dispatch on `Comm{target}` types:
```julia
function IJulia.register_comm(comm::IJulia.Comm{:positron_variables}, data)
    # Handle comm open
end
```

**Fix Needed**:
Rewrite kernel.jl comm registration to use IJulia's type dispatch pattern instead of function handlers.

**Files to Update**:
- src/kernel.jl: register_comm_target and register_comm_targets!
- May need to adjust how services are initialized

**Reference**: IJulia/src/comm_manager.jl for proper pattern

**Priority**: High - blocks runtime functionality

**Workaround**: Services work when loaded directly, just not auto-registered via kernel startup.

