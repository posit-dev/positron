# Positron Julia

Julia language support for Positron IDE.

## Features

- Julia runtime discovery and session management
- Variables pane integration
- Data Explorer for DataFrames
- Plots viewer integration
- Help system integration
- LSP-based code intelligence via LanguageServer.jl

## Requirements

- Julia 1.9 or later
- IJulia package for Jupyter kernel support
- LanguageServer.jl for code intelligence

## Julia Installation

We recommend using [juliaup](https://github.com/JuliaLang/juliaup), the official Julia version manager. It's similar to rustup for Rust or nvm for Node.js.

### Installing juliaup

**macOS/Linux:**
```bash
curl -fsSL https://install.julialang.org | sh
```

**Windows:**
```powershell
winget install julia -s msstore
```

The installer will:
1. Install juliaup to `~/.juliaup/`
2. Install the latest stable Julia version
3. Add `~/.juliaup/bin` to your PATH

### juliaup Commands

```bash
# Check installed versions
juliaup status

# Install a specific version
juliaup add 1.10

# Install LTS version
juliaup add lts

# Set default version
juliaup default 1.10

# Update all installed versions
juliaup update
```

### Julia Environments

Julia uses project-specific environments (similar to Python's venv). Key files:
- `Project.toml` - Project dependencies
- `Manifest.toml` - Locked dependency versions

```bash
# Activate a project environment
julia --project=/path/to/project

# Or from the Julia REPL
julia> ]activate /path/to/project
```

## Development Setup

### Building the Extension

```bash
cd extensions/positron-julia
npm install
npm run compile
```

### Positron.jl Library

The `julia/Positron/` directory contains the Julia-side implementation of Positron's comm-based services. The comm types are auto-generated from OpenRPC schemas.

#### Regenerating Comm Types

```bash
cd /path/to/positron
npx ts-node positron/comms/generate-comms.ts
```

This generates:
- `julia/Positron/src/*_comm.jl` - Julia comm type definitions

#### Testing the Julia Library

The Positron.jl library includes a comprehensive test suite covering variable inspection,
comm protocols, and type handling.

**Run all tests:**
```bash
cd extensions/positron-julia/julia/Positron
julia --project=. -e 'using Pkg; Pkg.test()'
```

**Run specific test file during development:**
```julia
# From Julia REPL in the Positron project directory
julia> include("test/test_variables.jl")  # Variables and comm handling
julia> include("test/test_inspectors.jl")  # Type inspection tests
julia> include("test/test_jsonrpc.jl")     # JSON-RPC protocol tests
```

**Test with Revise.jl for rapid iteration:**
```julia
using Pkg
Pkg.add("Revise")

using Revise
includet("src/Positron.jl")  # Auto-reload on changes
include("test/test_variables.jl")
```

**Test with code coverage:**
```bash
# Run tests with coverage enabled
julia --project=. --code-coverage=user -e 'using Pkg; Pkg.test()'

# View coverage summary
julia --project=. -e 'using Coverage; coverage = process_folder(); covered, total = get_summary(coverage); println("Coverage: $(round(covered/total*100, digits=2))%")'

# Generate HTML coverage report (requires Coverage.jl)
julia --project=. -e 'using Pkg; Pkg.add("Coverage"); using Coverage;
    coverage = process_folder();
    covered, total = get_summary(coverage);
    println("Coverage: $covered/$total = $(round(covered/total*100, digits=2))%");
    LCOV.writefile("coverage.info", coverage)'

# Clean coverage files
find . -name "*.cov" -delete
```

**Test dependencies:**
The test suite requires DataFrames.jl (automatically handled by Project.toml extras):
```julia
# Test dependencies are installed automatically by Pkg.test()
# Manual installation if needed:
julia -e 'using Pkg; Pkg.add("DataFrames")'
```

**Test coverage (462+ tests):**
- **Variables (335 tests):**
  - All Julia types (primitives, collections, composites, DataFrames)
  - Display formatting with dimensions and truncation
  - Child inspection and nested path resolution
  - Clipboard formatting and serialization
  - Comm protocol and message handling

- **Help (68 tests):**
  - Symbol resolution (simple and module-qualified)
  - Documentation fetching and Markdown→HTML conversion
  - Request handling and error cases

- **Data Explorer (59 tests):**
  - Virtual index management (filter, sort, combined views)
  - Efficient get_data_values with view mapping
  - Multi-column sorting with stability
  - DataFrame edge cases (empty, single row/col, missing, large)
  - Performance benchmarks (1M row sorts)

**Interactive testing:**
A comprehensive interactive testing file is available at `~/code/positron-testingstuff/testing.jl`
with examples of all supported variable types. Load it in Positron to test the Variables pane:

```julia
include("$(homedir())/code/positron-testingstuff/testing.jl")
```

### Required Julia Packages

For development, install these packages in your Julia environment:

```julia
using Pkg
Pkg.add(["IJulia", "LanguageServer", "JSON3", "StructTypes"])
```

## Architecture

The extension consists of:

1. **TypeScript Extension** (`src/`) - VS Code extension that:
   - Discovers Julia installations via juliaup
   - Manages Julia runtime sessions
   - Handles LSP client for code intelligence

2. **Positron.jl Library** (`julia/Positron/`) - Julia package that:
   - Implements Positron comm protocols (Variables, Help, Plots, Data Explorer)
   - Integrates with IJulia for Jupyter kernel support
   - Provides the bridge between Julia and Positron's UI

## Troubleshooting

### Julia not found

Ensure juliaup is installed and `~/.juliaup/bin` is in your PATH:
```bash
echo $PATH | grep juliaup
julia --version
```

### Reinstalling juliaup

If you have a broken installation:
```bash
# Remove old installation
rm -rf ~/.juliaup ~/.julia/juliaup

# Reinstall
curl -fsSL https://install.julialang.org | sh
```

## Resources

- [Julia Documentation](https://docs.julialang.org/)
- [juliaup GitHub](https://github.com/JuliaLang/juliaup)
- [IJulia Documentation](https://julialang.github.io/IJulia.jl/stable/)

## Code Formatting

All Julia code must be formatted with JuliaFormatter before committing.

```bash
# Format all Julia code
make format
```

This ensures:
- Consistent 4-space indentation (Julia standard)
- No formatting-related diff noise
- Clean git history

**Run `make format` before every commit.**

