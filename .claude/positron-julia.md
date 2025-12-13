# Positron Julia Extension Development

This guide covers development workflows for the positron-julia extension and the Positron.jl library.

## Project Structure

```
extensions/positron-julia/
├── src/                    # TypeScript extension code
│   └── extension.ts        # Main extension entry point
├── julia/Positron/         # Julia library package
│   ├── src/
│   │   ├── Positron.jl                # Main module
│   │   ├── comm.jl                    # Comm infrastructure
│   │   ├── jsonrpc.jl                 # JSON-RPC protocol
│   │   ├── variables.jl               # Variables service
│   │   ├── variables_comm.jl          # Generated comm types
│   │   ├── help.jl, plots.jl, etc.   # Other services
│   │   └── kernel.jl                  # IJulia integration
│   ├── test/
│   │   ├── runtests.jl                # Main test runner
│   │   ├── test_variables.jl          # Variables tests (148 tests)
│   │   ├── test_inspectors.jl         # Type inspection tests (166 tests)
│   │   ├── test_helpers.jl            # Mock utilities
│   │   └── test_*.jl                  # Other test files
│   ├── Project.toml                   # Package manifest
│   └── Manifest.toml                  # Dependency lockfile
└── README.md
```

## Julia Setup

### Prerequisites

1. **Install juliaup** (Julia version manager):
```bash
curl -fsSL https://install.julialang.org | sh
```

2. **Ensure Julia is in PATH:**
```bash
# Should be added automatically to ~/.zshrc or ~/.bashrc
julia --version  # Should show Julia 1.12.x
```

3. **Install JuliaFormatter** (for code generation):
```bash
julia -e 'using Pkg; Pkg.add("JuliaFormatter")'
```

## Development Workflows

### Testing

**Run all tests (recommended):**
```bash
cd extensions/positron-julia/julia/Positron
julia --project=. -e 'using Pkg; Pkg.test()'
```

**Quick test during development:**
```julia
# Start Julia REPL in project directory
julia --project=.

# Load Positron module
using Positron

# Run specific tests
include("test/test_variables.jl")
include("test/test_inspectors.jl")
```

**Test with auto-reload (Revise.jl):**
```julia
using Pkg; Pkg.add("Revise")
using Revise

# Load with auto-reload
includet("src/Positron.jl")
include("test/test_variables.jl")

# Make changes to src/*.jl - they'll be automatically reloaded
# Re-run tests to see results
```

### Code Generation

The comm type definitions are auto-generated from OpenRPC JSON schemas.

**Prerequisites:**
- Julia must be in PATH
- JuliaFormatter must be installed

**Generate all comm types:**
```bash
cd positron
PATH="$HOME/.juliaup/bin:$PATH" npx ts-node positron/comms/generate-comms.ts
```

**Generate specific comm:**
```bash
PATH="$HOME/.juliaup/bin:$PATH" npx ts-node positron/comms/generate-comms.ts variables
```

**Output files:**
- `julia/Positron/src/*_comm.jl` - Generated type definitions
- Automatically formatted with JuliaFormatter

**Generator behavior:**
- Skips Julia generation if `julia` not in PATH (helpful for non-Julia developers)
- Shows warning if JuliaFormatter not installed (code generated but unformatted)

### Interactive Testing

A comprehensive testing file with all supported variable types is available:

```julia
# Load in Positron Julia console to populate Variables pane
include("$(homedir())/code/positron-testingstuff/testing.jl")
```

This creates variables of all supported types for manual testing:
- Primitives: booleans, integers, floats, complex, strings
- Collections: arrays, matrices, ranges, tuples, sets, dicts
- Composite: structs (Point, Person, Rectangle, etc.)
- Functions: built-in, anonymous, named
- DataFrames: simple, large, with missing values, wide
- Nested structures

## Supported Variable Types

### Core Types (Full Support)
- **Primitives**: Bool, Int*, UInt*, Float*, Complex, String, Symbol
- **Special**: nothing, missing
- **Collections**: Vector, Matrix, Dict, Range
- **Functions**: Built-in, anonymous, named functions
- **Types**: Type references (Int64, String, etc.)
- **Composite**: Struct instances (user-defined types)

### Extended Types
- **Tuples**: Regular and named tuples (classified as Other)
- **Sets**: Classified as Other (could be Collection in future)
- **DateTime**: DateTime, Date, Time from Dates stdlib

### Data Science Types (Important!)
- **DataFrames**: Full support via Tables.jl interface
- **Matrices**: Viewable in data explorer
- **Large vectors**: View support for vectors > 10 elements

### Inspection Features
- **Nested access**: Drill into dicts, arrays, struct fields
- **Children enumeration**: Up to 100 children shown
- **Display formatting**: Truncation for long values (>1000 chars)
- **Size calculation**: Memory footprint via Base.summarysize
- **Type info**: Detailed type information with truncation

## Known Issues and Limitations

### Type Name Conflicts
**Issue**: `UpdateParams` and `RefreshParams` exist in multiple comm files (variables, plots)
causing naming conflicts.

**Current workaround**: Use named tuple construction in variables.jl:
```julia
params = create_variables_update_params(assigned, unevaluated, removed, version)
```

**Proper fix**: Update code generator to prefix param types with comm name
(e.g., `VariablesUpdateParams`, `PlotsUpdateParams`)

### Variable Deletion
**Issue**: Julia doesn't support true variable deletion from namespaces.

**Current behavior**: Delete operations are acknowledged but don't actually remove variables.

**Future**: Consider using workspace management or marking variables as deleted.

### Pre-commit Hook Warnings
**Issue**: Generated Julia files use 4-space indentation (Julia standard) but Positron
prefers tabs, causing pre-commit warnings.

**Status**: Warnings are cosmetic and don't prevent commits. Julia files should follow
Julia conventions.

## Architecture Notes

### Comm Infrastructure
- **PositronComm**: Wrapper around IJulia comm for JSON-RPC communication
- **MockComm**: Test double that captures messages instead of sending
- **JSON-RPC**: Request/response and notification patterns

### Variables Service
- **VariablesService**: Manages variables pane state and updates
- **Snapshot tracking**: Diffs current vs. last snapshot for efficient updates
- **Change detection**: Sends update events only when variables change
- **Version tracking**: Incremental version numbers for frontend sync

### Type System Integration
- **get_variable_kind()**: Maps Julia types to VariableKind enum
- **Introspection**: Uses `fieldnames()`, `getfield()` for struct inspection
- **Duck typing**: Tables.jl interface for DataFrame-like objects

## Testing Best Practices

### Test Organization
- Use `@testset` blocks for grouping related tests
- Name testsets descriptively
- Keep test files focused (<500 lines each)

### Test Data
- Use `@eval Main` to create global test variables
- Clean up with try/finally if needed (though Julia can't truly delete)
- Use `@test_throws` for error cases

### Mocking
- Use `MockComm` from test_helpers.jl for comm testing
- Extend methods for MockComm when needed
- Keep mocks minimal and focused

### Running Tests
- `Pkg.test()` creates clean environment each time
- Use `include()` for faster iteration
- Use Revise.jl for rapid development

## Common Tasks

### Add support for a new Julia type
1. Update `get_variable_kind()` in variables.jl
2. Add tests to test_inspectors.jl
3. Consider if type needs special viewer support
4. Update is_table_like() if it's a table type

### Add a new comm method
1. Update OpenRPC JSON schema in `positron/comms/`
2. Regenerate comm types: `npx ts-node positron/comms/generate-comms.ts`
3. Implement handler in service file (e.g., variables.jl)
4. Add tests for the new method
5. Update integration in kernel.jl if needed

### Debug comm issues
1. Enable debug logging in Julia:
```julia
ENV["JULIA_DEBUG"] = "Positron"
```

2. Check message payloads in test output
3. Use MockComm to verify message format
4. Compare with Python implementation for reference

## Resources

- [Julia Test.jl Docs](https://docs.julialang.org/en/v1/stdlib/Test/)
- [StructTypes.jl Docs](https://juliadata.github.io/StructTypes.jl/stable/)
- [IJulia Docs](https://julialang.github.io/IJulia.jl/stable/)
- [DataFrames.jl](https://dataframes.juliadata.org/stable/)
- [Tables.jl Interface](https://tables.juliadata.org/stable/)

## Quick Reference

```bash
# Run tests
julia --project=. -e 'using Pkg; Pkg.test()'

# Generate comm types
PATH="$HOME/.juliaup/bin:$PATH" npx ts-node positron/comms/generate-comms.ts

# Install Julia package
julia -e 'using Pkg; Pkg.add("PackageName")'

# Update dependencies
julia --project=. -e 'using Pkg; Pkg.update()'

# Check package status
julia --project=. -e 'using Pkg; Pkg.status()'
```
