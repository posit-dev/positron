# Julia Support for Positron - Implementation Plan

## Executive Summary

This document outlines a comprehensive plan to add Julia language support to Positron, modeled after the existing R support architecture. Julia support will include:

- **Runtime Discovery**: Automatic detection of Julia installations
- **Kernel Integration**: IJulia-based Jupyter kernel with Positron extensions
- **Language Intelligence**: LanguageServer.jl integration for code completion, diagnostics, hover, etc.
- **Data Science Features**: Variables pane, Data Explorer, Plots viewer
- **Console/REPL**: Full Julia REPL with tab completion

## Architecture Overview

### Comparison with Existing Language Support

| Component | R (positron-r) | Python (positron-python) | Julia (positron-julia) |
|-----------|----------------|--------------------------|------------------------|
| **VS Code Extension** | positron-r | positron-python | positron-julia (new) |
| **Jupyter Kernel** | ark (Rust, custom) | ipykernel + positron_ipkernel | IJulia + PositronJulia.jl (new) |
| **Comms Implementation** | In ark (Rust) | positron_ipkernel (Python) | PositronJulia.jl (new Julia pkg) |
| **LSP** | Built into ark | Jedi (bundled) or Pylance | LanguageServer.jl |
| **Supervisor Integration** | Via positron-supervisor | Via positron-supervisor | Via positron-supervisor |

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         POSITRON FRONTEND                           │
│  (Variables Pane, Data Explorer, Plots, Console, Help, Connections) │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ Positron API
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    POSITRON-JULIA EXTENSION                         │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ JuliaRuntime    │  │ JuliaSession    │  │ JuliaLsp            │ │
│  │ Manager         │  │ Manager         │  │ (LanguageClient)    │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬───────────┘ │
│           │                    │                     │             │
│  ┌────────▼────────┐  ┌────────▼────────┐           │             │
│  │ Julia Runtime   │  │ Julia Session   │           │             │
│  │ Discoverer      │  │ (wraps kernel)  │           │             │
│  └─────────────────┘  └─────────────────┘           │             │
└───────────────────────────────┬─────────────────────┼─────────────┘
                                │                     │
                    ┌───────────▼───────────┐         │ TCP Socket
                    │ POSITRON-SUPERVISOR   │         │
                    │ (Kallichore)          │         │
                    └───────────┬───────────┘         │
                                │ ZeroMQ              │
                                ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          JULIA PROCESS                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      IJulia Kernel                           │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │              PositronJulia.jl (new)                   │  │   │
│  │  │                                                       │  │   │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │  │   │
│  │  │  │ Variables   │ │ DataExplorer│ │ Plots           │ │  │   │
│  │  │  │ Service     │ │ Service     │ │ Service         │ │  │   │
│  │  │  └─────────────┘ └─────────────┘ └─────────────────┘ │  │   │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │  │   │
│  │  │  │ UI          │ │ Help        │ │ Connections     │ │  │   │
│  │  │  │ Service     │ │ Service     │ │ Service         │ │  │   │
│  │  │  └─────────────┘ └─────────────┘ └─────────────────┘ │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  LanguageServer.jl                           │   │
│  │  (Separate process, TCP connection to extension)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Detailed Component Design

### 1. VS Code Extension: positron-julia

**Location:** `extensions/positron-julia/`

**Key Files:**
```
extensions/positron-julia/
├── package.json                 # Extension manifest
├── src/
│   ├── extension.ts            # Entry point
│   ├── constants.ts            # Julia-specific constants
│   ├── julia-installation.ts   # Julia binary validation
│   ├── provider.ts             # Runtime discovery providers
│   ├── runtime-manager.ts      # JuliaRuntimeManager
│   ├── session-manager.ts      # JuliaSessionManager
│   ├── session.ts              # JuliaSession
│   ├── kernel-spec.ts          # Jupyter kernel spec generation
│   ├── lsp.ts                  # LanguageServer.jl integration
│   ├── commands.ts             # Julia-specific commands
│   └── positron-supervisor.d.ts # Type declarations
├── resources/
│   └── julia.png               # Julia logo icon
└── syntaxes/
    └── julia.tmLanguage.json   # Syntax highlighting (can use existing)
```

#### 1.1 Julia Runtime Discovery

Julia installations will be discovered from:

1. **PATH environment variable** - `julia` command
2. **Standard installation locations:**
   - macOS: `/Applications/Julia-*.app/Contents/Resources/julia/bin/julia`
   - macOS: `~/.juliaup/bin/julia` (juliaup)
   - Linux: `/usr/bin/julia`, `/usr/local/bin/julia`
   - Linux: `~/.juliaup/bin/julia` (juliaup)
   - Windows: `%LOCALAPPDATA%\Programs\Julia-*\bin\julia.exe`
   - Windows: `%USERPROFILE%\.juliaup\bin\julia.exe` (juliaup)
3. **juliaup installations** - Query `juliaup status` for managed versions
4. **User-configured paths** - Via settings

**JuliaInstallation interface:**
```typescript
interface JuliaInstallation {
    binpath: string;           // Path to julia executable
    homepath: string;          // JULIA_HOME equivalent
    version: string;           // e.g., "1.10.2"
    semVersion: semver.SemVer;
    arch: string;              // x86_64, aarch64
    reasonDiscovered: ReasonDiscovered;
}
```

#### 1.2 Kernel Specification

The kernel spec will launch Julia with IJulia and PositronJulia.jl:

```typescript
function createJuliaKernelSpec(installation: JuliaInstallation): JupyterKernelSpec {
    return {
        argv: [
            installation.binpath,
            '--project=@positron',  // Use dedicated project
            '-e',
            'using IJulia, PositronJulia; PositronJulia.start()',
            '{connection_file}'
        ],
        display_name: `Julia ${installation.version}`,
        language: 'julia',
        env: {
            JULIA_NUM_THREADS: 'auto',
            // Additional env vars
        }
    };
}
```

#### 1.3 Session Management

**JuliaSession** will:
- Wrap the Jupyter kernel session from positron-supervisor
- Manage LSP lifecycle (start/stop LanguageServer.jl)
- Handle DAP for debugging
- Route kernel messages to Positron

### 2. Julia Package: PositronJulia.jl

**Location:** New repository or `extensions/positron-julia/julia_files/PositronJulia/`

This Julia package extends IJulia to implement Positron-specific comms.

**Package Structure:**
```
PositronJulia/
├── Project.toml
├── src/
│   ├── PositronJulia.jl       # Main module, entry point
│   ├── comm.jl                # Base comm infrastructure
│   ├── jsonrpc.jl             # JSON-RPC 2.0 implementation
│   │
│   ├── services/
│   │   ├── ui.jl              # UI comm service
│   │   ├── variables.jl       # Variables comm service
│   │   ├── data_explorer.jl   # Data Explorer comm service
│   │   ├── plots.jl           # Plots comm service
│   │   ├── help.jl            # Help comm service
│   │   ├── connections.jl     # Connections comm service
│   │   └── lsp.jl             # LSP coordination service
│   │
│   ├── inspectors/
│   │   ├── base.jl            # Base type inspection
│   │   ├── arrays.jl          # Array/Matrix inspection
│   │   ├── dataframes.jl      # DataFrames inspection
│   │   ├── tables.jl          # Tables.jl interface
│   │   └── custom.jl          # Custom type handlers
│   │
│   └── backends/
│       ├── plots_backend.jl   # Plots.jl backend
│       └── makie_backend.jl   # Makie backend
│
└── test/
    └── runtests.jl
```

#### 2.1 Comm Infrastructure

```julia
# Base comm wrapper (similar to Python's PositronComm)
mutable struct PositronComm
    comm::IJulia.Comm
    handlers::Dict{String, Function}
    lock::ReentrantLock
end

function send_result(pc::PositronComm, result)
    # JSON-RPC result response
end

function send_error(pc::PositronComm, code::Int, message::String)
    # JSON-RPC error response
end

function send_event(pc::PositronComm, method::String, params)
    # JSON-RPC notification
end
```

#### 2.2 Variables Service

The variables service must inspect Julia's global scope and provide:

```julia
struct Variable
    access_key::String
    display_name::String
    display_value::String
    display_type::String
    type_info::String
    size::Int64
    kind::String  # "number", "string", "array", "table", etc.
    length::Int64
    has_children::Bool
    has_viewer::Bool
    is_truncated::Bool
    updated_time::Int64
end

# Key methods to implement:
function list_variables()::Vector{Variable}
function inspect_variable(path::Vector{String})::Vector{Variable}
function delete_variables(names::Vector{String})::Vector{String}
function clear_variables(include_hidden::Bool)
function format_for_clipboard(path::Vector{String}, format::String)::String
function open_viewer(path::Vector{String})::Union{String, Nothing}
```

**Type mapping for `kind` field:**
- `Int`, `Float64`, `Complex` → `"number"`
- `String`, `Char` → `"string"`
- `Bool` → `"boolean"`
- `Array`, `Vector`, `Matrix` → `"collection"`
- `Dict` → `"map"`
- `DataFrame`, `Tables.jl types` → `"table"`
- `Function` → `"function"`
- `Module` → `"class"`
- `Nothing`, `Missing` → `"empty"`

#### 2.3 Data Explorer Service

Must support Tables.jl interface for maximum compatibility:

```julia
# Supported types (via Tables.jl):
# - DataFrames.DataFrame
# - CSV.File
# - Arrow.Table
# - TypedTables.Table
# - Any Tables.jl-compatible type

struct DataExplorerService
    tables::Dict{String, Any}  # comm_id -> table reference
end

# Key methods:
function get_schema(table, column_indices::Vector{Int})
function search_schema(table, filters, sort_order)
function get_data_values(table, columns, format_options)
function get_row_labels(table, selection)
function get_column_profiles(table, columns, callback_id)
```

#### 2.4 Plots Service

Support major Julia plotting libraries:

**Plots.jl Integration:**
```julia
# Custom display backend that captures plots
struct PositronPlotsBackend <: Plots.AbstractBackend end

function Plots.display_dict(plt::Plots.Plot{PositronPlotsBackend})
    # Render to PNG/SVG and send via comm
end
```

**Makie.jl Integration:**
```julia
# Intercept Makie display
function Base.display(d::PositronDisplay, scene::Makie.Scene)
    # Render and send via comm
end
```

#### 2.5 Help Service

```julia
function show_help_topic(topic::String)::Bool
    # Use Julia's built-in help system
    # Check if topic exists in documentation
    # Return HTML-formatted help content
end
```

### 3. LSP Integration

**LanguageServer.jl** provides full LSP support. Integration approach:

1. **Extension starts LSP process:**
```typescript
const lspProcess = spawn('julia', [
    '--project=@LanguageServer',
    '-e',
    'using LanguageServer; runserver()'
], {
    env: { JULIA_NUM_THREADS: '1' }  // LSP is single-threaded
});
```

2. **Connect via TCP socket** (similar to ark LSP)
3. **Register document selectors:**
   - `*.jl` files
   - Julia notebooks
   - Console input

**LSP Capabilities to support:**
- `textDocument/completion` - Code completion
- `textDocument/hover` - Hover information
- `textDocument/definition` - Go to definition
- `textDocument/references` - Find references
- `textDocument/documentSymbol` - Document outline
- `textDocument/formatting` - Code formatting (via JuliaFormatter.jl)
- `textDocument/publishDiagnostics` - Error/warning diagnostics

### 4. Connections Service (Database Support)

Support for database connections via Julia packages:

```julia
# Supported connection types:
# - LibPQ.jl (PostgreSQL)
# - MySQL.jl
# - SQLite.jl
# - ODBC.jl
# - DBInterface.jl (generic)

struct ConnectionsService
    connections::Dict{String, Any}
end

function list_objects(conn, path::Vector{ObjectSchema})
    # Use DBInterface to introspect schemas, tables
end

function list_fields(conn, path::Vector{ObjectSchema})
    # Get column information
end
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-3)

**Goal:** Basic Julia runtime discovery and kernel execution

**Tasks:**
1. Create `positron-julia` extension scaffolding
2. Implement Julia installation discovery
3. Create kernel spec generation
4. Basic IJulia integration (code execution only)
5. Console input/output working

**Deliverables:**
- Can discover Julia installations
- Can start Julia kernel
- Can execute Julia code in console
- Basic output display

### Phase 2: Core Comms (Weeks 4-6)

**Goal:** Implement essential Positron comms

**Tasks:**
1. Create PositronJulia.jl package structure
2. Implement comm infrastructure (JSON-RPC)
3. Implement UI comm
4. Implement Variables comm (basic types)
5. Implement Help comm

**Deliverables:**
- Variables pane shows Julia variables
- Help system works
- Basic UI interactions (clear console, open editor)

### Phase 3: Language Intelligence + Plots

**Goal:** LSP integration and plotting support

**Priority Note:** LSP and Plots are prioritized before Data Explorer to establish
the core interactive development experience first.

**Tasks:**
1. Integrate LanguageServer.jl
2. Implement LSP client in extension
3. Tab completion in console
4. Code completion in editor
5. Diagnostics, hover, go-to-definition
6. Implement Plots comm with Plots.jl backend
7. Add Makie.jl backend support

**Deliverables:**
- Full code intelligence in editor
- Tab completion in console
- Error diagnostics
- Plots display in Plots pane

### Phase 4: Data Explorer

**Goal:** Table/DataFrame viewing and exploration

**Tasks:**
1. Implement Data Explorer comm
2. Add Tables.jl support for generic table interface
3. DataFrames.jl integration
4. Extend Variables comm for complex types
5. Type inspectors for nested data structures

**Deliverables:**
- Can view DataFrames in Data Explorer
- Full variable inspection for complex types
- Schema browsing and data filtering

### Phase 5: Advanced Features

**Goal:** Polish and advanced features

**Tasks:**
1. Implement Connections comm
2. Debug Adapter Protocol support
3. Julia testing framework integration
4. Performance optimization
5. Error handling improvements
6. Documentation

**Deliverables:**
- Database connections browser
- Debugging support
- Test explorer integration
- Production-ready implementation

## Technical Decisions

### Decision 1: PositronJulia.jl Location

**Options:**
1. **Separate repository** (like ark for R)
   - Pros: Independent versioning, cleaner separation
   - Cons: More complex release process

2. **Within positron repo** (like positron_ipkernel for Python)
   - Pros: Simpler development, atomic commits
   - Cons: Repository bloat

**Recommendation:** Start within positron repo (`extensions/positron-julia/julia_files/`), extract later if needed.

### Decision 2: Julia Version Support

**Recommendation:** Support Julia 1.9+ (current LTS is 1.10)
- LanguageServer.jl requires Julia 1.6+
- Modern Julia features simplify implementation
- Aligns with active Julia ecosystem

### Decision 3: Plotting Backend Strategy

**Options:**
1. **Plots.jl only** - Most popular, supports multiple backends
2. **Makie.jl only** - Modern, GPU-accelerated
3. **Both** - Maximum compatibility

**Recommendation:** Support both, with Plots.jl as default.

### Decision 4: LSP Process Model

**Options:**
1. **In-kernel LSP** (like ark) - Same process as execution
2. **Separate process** (like Pylance) - Independent LSP server

**Recommendation:** Separate process for stability (LanguageServer.jl is designed this way).

## Dependencies

### Julia Packages Required

**Core:**
- `IJulia` - Jupyter kernel
- `JSON3` - JSON serialization
- `UUIDs` - Unique identifiers

**Data Science:**
- `Tables` - Generic table interface
- `DataFrames` - Primary DataFrame support
- `PrettyTables` - Table formatting

**Plotting:**
- `Plots` - Meta-plotting package
- `Makie` (optional) - Modern plotting

**LSP:**
- `LanguageServer` - LSP implementation
- `SymbolServer` - Symbol indexing

**Database:**
- `DBInterface` - Generic database interface
- Package-specific: `LibPQ`, `SQLite`, `MySQL`, etc.

### VS Code Extension Dependencies

- `@anthropic/positron` - Positron API types
- `positron-supervisor` - Kernel management
- `vscode-languageclient` - LSP client

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| IJulia incompatibility | Low | High | Contribute upstream fixes |
| LanguageServer.jl stability | Medium | Medium | Version pinning, fallback |
| Julia package ecosystem changes | Medium | Low | CI testing, version bounds |
| Performance (large DataFrames) | Medium | Medium | Lazy loading, pagination |
| Cross-platform issues | Medium | Medium | CI on all platforms |

## Success Metrics

1. **Functionality:** All 6 comms working (UI, Variables, Data Explorer, Plots, Help, Connections)
2. **Performance:** Variable listing < 100ms for typical workspace
3. **Reliability:** < 1% kernel crash rate
4. **Compatibility:** Works with Julia 1.9, 1.10, 1.11+
5. **User satisfaction:** Comparable experience to R/Python

## Open Questions

1. Should we bundle LanguageServer.jl or require user installation?
2. How to handle Julia's precompilation time for first startup?
3. Should we support Julia environments/projects in the runtime selector?
4. How to handle Julia's package manager (Pkg) integration?
5. Should we implement Julia-specific commands (like R's pipe insertion)?

## Code Generation for Julia Comms

### Existing Code Generation Infrastructure

Positron uses a sophisticated code generation system (`positron/comms/generate-comms.ts`) that generates comm interface code from OpenRPC JSON specifications. Currently it generates:

- **TypeScript** → `src/vs/workbench/services/languageRuntime/common/positron{Name}Comm.ts`
- **Rust** → `ark/crates/amalthea/src/comm/{name}_comm.rs` (for the ark R kernel)
- **Python** → `extensions/positron-python/python_files/posit/positron/{name}_comm.py`

### Adding Julia Code Generation

We will extend `generate-comms.ts` to also generate Julia code. This ensures:

1. **Type Safety**: Generated structs match the OpenRPC specs exactly
2. **Consistency**: Julia comms will be wire-compatible with Python/R
3. **Maintainability**: Changes to comms specs automatically propagate to Julia
4. **Reduced Errors**: No manual transcription of complex type definitions

### Julia Type Mapping

```typescript
// Maps from JSON schema types to Julia types
const JuliaTypeMap: Record<string, string> = {
    'boolean': 'Bool',
    'integer': 'Int64',
    'number': 'Float64',
    'string': 'String',
    'null': 'Nothing',
    'array-begin': 'Vector{',
    'array-end': '}',
    'object': 'Dict{String, Any}',
};
```

### Generated Julia Code Structure

For each comm, we'll generate a Julia module with:

```julia
# Auto-generated from {name}.json
module {Name}Comm

using JSON3
using StructTypes

# Enums
@enum VariableKind begin
    Boolean = "boolean"
    Number = "number"
    String = "string"
    # ...
end

# Structs (with JSON3 serialization)
struct Variable
    access_key::String
    display_name::String
    display_value::String
    display_type::String
    type_info::String
    size::Int64
    kind::VariableKind
    length::Int64
    has_children::Bool
    has_viewer::Bool
    is_truncated::Bool
    updated_time::Int64
end

# StructTypes configuration for JSON serialization
StructTypes.StructType(::Type{Variable}) = StructTypes.Struct()

# Request/Response types
struct ListRequest
    method::String  # "list"
    jsonrpc::String # "2.0"
end

struct ListResult
    variables::Vector{Variable}
    length::Int64
    version::Int64
end

# Backend request enum
@enum BackendRequest begin
    List = "list"
    Clear = "clear"
    Delete = "delete"
    Inspect = "inspect"
    ClipboardFormat = "clipboard_format"
    View = "view"
end

# Frontend event enum
@enum FrontendEvent begin
    Update = "update"
    Refresh = "refresh"
end

end # module
```

### Output Location

Generated Julia files will be written to:
```
extensions/positron-julia/julia_files/PositronJulia/src/generated/{name}_comm.jl
```

### Generator Implementation Tasks

1. Add `JuliaTypeMap` to `generate-comms.ts`
2. Create `createJuliaComm()` generator function
3. Create `createJuliaValueTypes()` for structs/enums
4. Handle Julia-specific serialization (JSON3/StructTypes)
5. Generate proper module structure
6. Add Julia output path configuration

## References

- [IJulia.jl](https://github.com/JuliaLang/IJulia.jl) - Julia Jupyter kernel
- [LanguageServer.jl](https://github.com/julia-vscode/LanguageServer.jl) - Julia LSP
- [Tables.jl](https://github.com/JuliaData/Tables.jl) - Generic table interface
- [Positron Comms Specification](../positron/comms/) - Comm protocol definitions
- [positron-r Extension](../extensions/positron-r/) - Reference implementation
- [positron-python Extension](../extensions/positron-python/) - Reference implementation
