# Quarto Inline Output

This feature provides Jupyter-style inline code execution and output display for Quarto (`.qmd`) and R Markdown (`.rmd`) documents inside the standard text editor. It lets users run code cells and see results directly beneath them, without switching to a separate notebook interface.

## Overview

Quarto documents are plain-text files that contain a mix of markdown prose and fenced code blocks. This feature parses those documents to identify the code blocks, manages a kernel session for execution, displays outputs inline as editor view zones, and persists results to a cache so they survive editor restarts.

The feature activates when a `.qmd` or `.rmd` file is opened and the Quarto extension is present.

## Architecture

The code is organized into three layers: **common** (pure logic, no UI), **browser** (editor integration and UI), and **test**.

### Common Layer

- **quartoParser** -- Parses QMD/Rmd text into a structured representation of frontmatter and code cells. Identifies fenced code blocks with language annotations (e.g. `` ```{python} ```) and extracts metadata like cell labels and execution options.
- **quartoTypes** -- Core type definitions shared across the feature: parsed cells, cell IDs, execution states.
- **quartoExecutionTypes** -- Service interface definitions (e.g. `IQuartoDocumentModelService`, `IQuartoKernelManager`, `IQuartoExecutionManager`, `IQuartoOutputCacheService`, `IQuartoOutputManager`).
- **quartoExecutionOptions** -- Parses per-cell execution options from Quarto's `#|` comment syntax (e.g. `#| eval: false`, `#| error: true`).
- **positronQuartoConfig** -- Configuration constants and context keys that control when menus, keybindings, and UI elements are visible.

### Browser Layer

#### Document Model

- **quartoDocumentModel** -- Tracks the parsed structure of a single open document. Reacts to text edits to keep its cell list in sync with the editor content. Generates stable cell IDs (based on index, content hash, and label) so outputs can be associated with cells even as the document is edited.
- **quartoDocumentModelService** -- A per-workspace service that creates and owns `quartoDocumentModel` instances, one per open document.

#### Kernel Management

- **quartoKernelManager** -- Manages one kernel session per document. Starts a kernel (via Positron's runtime infrastructure) based on the document's primary language, and handles lifecycle events like restart, shutdown, and interrupt. Restores kernel sessions after window reload by matching documents to their previous sessions.

#### Execution

- **quartoExecutionManager** -- Accepts execution requests and runs them through a sequential queue (one cell at a time per document). Collects output messages from the kernel and forwards them to the output layer. Supports several execution modes: full cell, partial selection, run-above, and run-below. Routes code to the appropriate backend -- the kernel for the document's primary language, the console for other languages, and the terminal for shell blocks.

#### Output Display

- **quartoOutputManager** -- Coordinates inline output display for a single editor. Creates, positions, and updates view zones below code cells. Restores cached outputs when an editor opens. Handles output actions like copy, save, and popout.
- **quartoOutputViewZone** -- The view zone widget itself: renders output content (text, images, errors, HTML, interactive widgets) into a DOM element that the Monaco editor inserts between lines.
- **quartoOutputCacheService** -- Persists cell outputs to global storage using ipynb (Jupyter notebook) format. Outputs survive editor close, window reload, and file rename. Uses LRU eviction to bound cache size.

#### Visual Chrome

- **quartoExecutionDecorations** -- Gutter decorations that indicate execution state: queued, running, succeeded, or errored. Uses a subtle animation for running cells.
- **quartoCellToolbar** -- A floating toolbar widget rendered above each code cell with Run, Stop, Run Above, and Run Below buttons.
- **quartoCellToolbarController** -- Manages the lifecycle of all cell toolbars for an editor, creating and repositioning them as the document changes.
- **quartoImagePreview** -- Renders inline previews of images referenced in markdown (e.g. `![](plot.png)`), distinct from code execution outputs.
- **QuartoKernelStatusBadge** -- A React component shown in the editor's action bar displaying the kernel's connection state (starting, idle, busy, etc.).

#### Entry Point

- **positronQuarto.contribution** -- Registers all services, editor contributions, commands, menus, and keybindings. This is the file that wires everything together at startup.

#### Commands

- **quartoCommands** -- Defines user-facing commands: run cell, run above, run below, run selection, clear outputs, restart kernel, etc. Registered in the contribution file and bound to keybindings.

## Data Flow

1. **Parse**: When a document opens or is edited, the document model re-parses it to produce an updated list of cells with stable IDs.
2. **Execute**: A user action (keybinding, toolbar click, command) triggers an execution request. The execution manager queues the request, ensures the kernel is running, and sends the code.
3. **Collect**: The kernel streams output messages (text, images, errors, HTML). The execution manager collects these into a result set.
4. **Display**: The output manager receives the result set and creates or updates a view zone beneath the cell.
5. **Cache**: The cache service persists the output to disk so it can be restored later.
6. **Restore**: When an editor reopens, the output manager loads cached outputs and recreates view zones.

## Key Design Decisions

- **Stable cell IDs** allow outputs to stay associated with their cell even as surrounding content is edited or cells are reordered.
- **ipynb cache format** reuses the standard Jupyter output schema rather than inventing a custom one.
- **Sequential execution queue** matches notebook semantics -- one cell runs at a time per document.
- **View zones** (a Monaco editor feature) are used for inline output rather than overlays or separate panels, so outputs scroll naturally with the document.
- **Multi-language routing** sends code to the kernel, console, or terminal depending on the block's language, enabling polyglot documents.

## Tests

### Unit Tests (`test/`)

- **quartoParser.test** -- Verifies parsing of code blocks, frontmatter, labels, and edge cases.
- **quartoExecutionOptions.test** -- Tests extraction of `#|` execution options from cell content.
- **quartoExecutionManager.test** -- Tests the execution queue, output collection, and multi-language routing.
- **quartoDocumentModel.test** -- Tests cell tracking, stable ID generation, and response to document edits.
- **quartoOutputManager.test** -- Tests view zone creation, positioning, and cache restoration.
- **quartoCellToolbar.test** -- Tests toolbar visibility and button state logic.

Unit tests are run with the core test runner:
```
./scripts/test.sh --runGlob '**/positronQuarto/**/*.test.js'
```

### End-to-End Tests (`test/e2e/tests/quarto/`)

- **quarto-python.test** -- Executes Python cells and verifies output.
- **quarto-r.test** -- Executes R cells and verifies output.
- **quarto-inline-output.test** -- Tests the inline output display lifecycle.
- **quarto-variables-follow.test** -- Verifies that executed code updates the Variables pane.

E2E tests require a running Positron instance and are run with Playwright.
