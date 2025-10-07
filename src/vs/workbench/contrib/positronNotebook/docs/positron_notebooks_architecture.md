# Positron Notebooks: Implementation Architecture

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Quick Start for Contributors](#quick-start-for-contributors)
3. [Architecture Overview](#architecture-overview)
4. [System Components](#system-components)
5. [Accessibility Implementation](#accessibility-implementation)
6. [Kernel Protocol and Integration](#kernel-protocol-and-integration)
7. [Positron Service Integrations](#positron-service-integrations)
8. [Testing and Debugging](#testing-and-debugging)
9. [File Organization](#file-organization)
10. [Current Status and Considerations](#current-status-and-considerations)

## Executive Summary

Positron Notebooks is a feature-flagged notebook editor that ships alongside the standard VS Code notebook experience. When `positron.notebook.enabled` is true, the editor registers as an optional handler for `.ipynb` resources while reusing VS Code's notebook models, kernel selection, execution, and working copy services. The user interface is implemented in React with observable-backed components. The implementation coexists with the built-in notebook editor: users can opt into Positron Notebooks via the `Open With…` menu or by configuring an editor association, and the feature can be disabled without impacting the standard experience.

## Quick Start for Contributors

### Enable the editor

1. Add the feature flag to your `settings.json` and restart Positron:
```json
{
    "positron.notebook.enabled": true
}
```
2. To make Positron the default handler for `.ipynb` files, add:
```json
{
    "workbench.editorAssociations": {
        "*.ipynb": "workbench.editor.positronNotebook"
    }
}
```
Alternatively, you can right-click a notebook, select `Open With…` -> `Configure Default editor...` -> `Positron Notebook` to avoid editing JSON directly.

Without this association, the Positron editor remains available in the `Open With…` menu.

3. Open or create an `.ipynb` file. The editor resolver constructs the necessary editor input, resolves the backing notebook model, and instantiates the Positron notebook editor.

To revert to the standard VS Code notebook editor, remove the feature flag (and association if set).

## Architecture Overview

Core design principles:

1. **Feature flagged** – all contributions check `positron.notebook.enabled`, allowing the editor to ship disabled by default.
2. **Parallel implementation** – registration priority is `RegisteredEditorPriority.option`; the built-in editor remains the default unless the user opts in.
3. **Shared infrastructure** – notebook models, kernel discovery, execution, diffing, and working copy management all use VS Code services.
4. **Observable state + React view** – notebook state lives in observables, consumed by React components.
5. **Context-key driven UX** – notebook and cell behaviors are controlled through scoped context keys that determine command availability and toolbar visibility.
6. **Explicit selection machine** – a finite state machine governs focus, editing, and multi-select states consistently across the UI and command layer.
7. **Action registry** – cell toolbars and menus use a registry pattern so contributions can add actions declaratively.

## System Components

### Configuration layer (`browser/positronNotebookExperimentalConfig.ts`)

- `positronNotebookExperimentalConfig.ts` registers the `positron.notebook.enabled` setting (machine-overridable, hidden, defaults to `false`).
- `workbench.editorAssociations` remains the mechanism for making Positron the default `.ipynb` editor. `usingPositronNotebooks()` in `common/positronNotebookCommon.ts` encapsulates the check.

### Editor registration and resolution (`browser/positronNotebook.contribution.ts`)

The contribution file registers editors only when the feature flag is enabled. Key responsibilities include:

- Registering the Positron notebook editor as an optional handler for `.ipynb` resources and notebook cell URIs.
- Providing support for untitled notebooks.
- Registering a working copy handler for backup restoration and an editor serializer for hot-exit scenarios.
- Installing notebook-level and cell-level commands, including execution controls, selection navigation, and markdown toggles.
- Adding an action to execute notebook selections in the console.

### Core architecture components

#### PositronNotebookEditorInput (`browser/PositronNotebookEditorInput.ts`)

The editor input manages the lifecycle of a notebook instance. It resolves notebook models through VS Code's services and implements save/revert/dirty state using working copy APIs. Each input is annotated with a unique ID for tracing.

#### PositronNotebookInstance (`browser/PositronNotebookInstance.ts`)

The instance is a singleton per notebook URI and serves as the central state manager. It maintains observables for cells, the runtime session, kernel selection and status, and the current language. The instance integrates with VS Code's notebook execution and kernel services, as well as Positron-specific runtime and console services. It manages view attachment/detachment, keyboard navigation, cell synchronization (reusing cell instances when possible), and clipboard actions. This is where most non-UI logic resides.

#### PositronNotebookService (`src/vs/workbench/services/positronNotebook/browser/positronNotebookService.ts`)

A global registry for active notebook instances, providing lookup by URI and methods to check if Positron Notebooks is in use.

#### PositronNotebookEditor (`browser/PositronNotebookEditor.tsx`)

The editor component extends VS Code's view state management and provides persistence keyed by notebook URI. It renders the React component tree with context providers for visibility, the notebook instance, and the editor environment. The editor cleans up resources on dispose.

#### PositronNotebookEditorControl (`browser/PositronNotebookEditorControl.ts`)

An adapter that implements the composite code editor interface. It tracks the currently selected cell and exposes its Monaco editor, enabling shared workbench features like inline chat and debugging that expect access to a code editor.


#### Context key management (`browser/ContextKeysManager.ts`)

Context keys are scoped at both the notebook and cell levels. Notebook-level keys track whether the container or editor is focused. Cell-level keys track properties like cell type, execution state, and whether a markdown editor is open. These keys are bound to each cell's DOM subtree to enable context-sensitive commands and menu items.

#### Webview preload integration (`browser/notebookCells/hooks/useWebviewMount.ts`)

The notebook instance registers with the webview preload service. Code cells inspect their outputs to determine preload requirements and claim outputs through the service. A React hook coordinates mounting output webviews, managing their lifecycle based on visibility, and constraining their height.

#### Execution services & kernel selection (`src/vs/workbench/contrib/runtimeNotebookKernel/browser/runtimeNotebookKernel*.ts`)

Cell execution cancels any running executions before delegating to VS Code's notebook execution service. Kernel selection leverages VS Code's kernel service and persists the selected kernel in view state. The runtime-backed kernel implementation orchestrates runtime startup and ensures sequential execution through a queue.

### Cell architecture (`browser/PositronNotebookCells/`)

```
IPositronNotebookCell
└─ PositronNotebookCellGeneral
   ├─ PositronNotebookCodeCell
   └─ PositronNotebookMarkdownCell
```

Key pieces:

- The general cell implementation provides shared functionality like execution observables, editor attachment, and selection helpers.
- Code cells parse outputs, integrate with the preload service for rich output rendering, and expose execution metadata such as duration and success status.
- Markdown cells render using a markdown component with support for deferred image loading of local assets.
- React layer components:
  - Cell wrappers handle focus management, screen-reader announcements, and per-cell context keys.
  - Monaco editor widgets embed the code editor, synchronize layout, and forward focus events.
  - Execution status components show execution progress and provide execution commands.
  - The cell action bar sources actions from a registry and filters them by context.
  - Quick action buttons enable inserting cells between existing cells.
  - A kernel status badge surfaces kernel state in the toolbar.

### Selection state management (`browser/selectionMachine.ts`)

The selection machine encapsulates all cell selection logic, including selecting cells, moving selection up or down, and multi-selection. It defines distinct selection states (no selection, single selection, multi-selection, and editing selection) and supports keyboard navigation with arrow keys and shift modifiers, editor entry/exit, and selection toggling. The notebook instance listens for selection changes to update context keys and manage focus state.

### Startup and integration flow

1. The feature flag is checked to determine if Positron Notebooks should be registered.
2. The editor resolver chooses Positron Notebooks when configured or explicitly requested.
3. An editor input is retrieved or created, resolving the notebook model (including untitled notebook support).
4. The editor initializes its control, renders the React component tree, and attaches the notebook instance with a scoped context key service.
5. Cell components attach to the instance, establish their context keys, and begin observing state.
6. Kernel selection is restored from view state or determined from suggestions; runtime session events are wired up via observables.
7. Working copy integration ensures dirty state and backup handling.

### Integration with VS Code systems

Positron Notebooks integrates with:
- **Notebook services** for model resolution, kernel management, and execution.
- **Editor platform** for editor resolution, registration, and working copy management.
- **Command and keybinding infrastructure** for notebook and cell actions.
- **Runtime services** for session management, language runtime integration, console interactions, and webview preloads.

### Key technical decisions

- **One webview per output**: VSCode notebooks have a single giant webview for all outputs. We make isolated webviews for each cells output instead. The main trade off of this decision is:
	- Pro: Way easier to deal with the dom. With vscode notebooks each editor needs to be positioned by pixel and kept in sync with outputs and scroll position.
	- Con: Multiple webviews is more expensive. Each webview needs all the preloads replayed into it (many probably not needed for a given output) and has the computational overhead of an iframe.
- Ultimately we decided this tradeoff was worth it as we can avoid needing to effectively recreate the whole block model layout system from scratch and can use native dom techniques. Adding something to an editor or changing padding doesn't require you to go in and fiddle with the layout algorithm to get things lining up again.
- **React renderer + observables**: Lots of `observableValue`s are used to keep track of moving state in an attmept to keep updates granular.
- **Editor control adapter**: `PositronNotebookEditorControl` provides a single point of integration for workbench features expecting a composite code editor.
- **Per-URI singleton instances**: ensures reopening editors or switching groups reuse the same in-memory state.
- **Context-key scoped actions**: per-cell context services enable rich when-clauses without polluting the global context space.

## Accessibility Implementation

Positron Notebooks implements accessibility features including keyboard navigation (arrow keys, Shift+arrow for multi-selection, Enter/Escape for edit mode), focus management with ARIA attributes, screen reader announcements for state changes, and accessible output rendering. See individual component files for implementation details.

## Kernel Protocol and Integration

The notebook instance selects kernels using VS Code's kernel service, falling back to suggestions when no explicit choice exists. The runtime-backed kernel implementation handles runtime session startup and serializes execution through a queue. It emits execution events for downstream services like the variables panel and console.

The execution flow retrieves or starts a runtime session, then enqueues cell execution requests. Cancellation requests are forwarded to the notebook execution service. The "Execute Selection in Console" action reuses the notebook's runtime session to run ad-hoc code in the Positron console.

## Positron Service Integrations

- **Runtime session service** – manages interpreter session lifecycle; events are consumed by the notebook instance.
- **Console service** – enables shared console integration for executing selections and displaying output.
- **Webview preload service** – coordinates widget and rich output messaging.
- **Plots & data explorer** – runtime events update the plots and variables panels.
- **Notebook service** – tracks active notebooks for other Positron UI components.

## Testing and Debugging

### Test coverage

The test suite includes more end-to-end tests than unit tests due to the visual nature of the system.

- **End-to-end tests** in `test/e2e/tests/notebook`
- **Unit tests** in `src/vs/workbench/contrib/positronNotebook/test/browser`

### Debugging strategies

- Use log service messages to trace lifecycle events throughout the editor, instance, and kernel components.
- If toolbar actions fail to appear, inspect the action registry and verify context keys and conditional clauses.
- For webview issues, enable developer tools and inspect messages.
- For selection or focus bugs, log the selection state machine's state and verify context key updates.

## Current Status and Considerations

- The feature flag defaults to off. Enabling it requires a restart because contributions register during workbench startup.
- Positron Notebooks supports the Jupyter notebook format (`.ipynb`). Diffing delegates to VS Code's built-in diff editor.
- Untitled notebooks are fully supported through the resolver and working copy handler.
- **Extension compatibility**: Kernel-level extensions continue to work due to shared kernel APIs, but DOM-dependent notebook extensions will not integrate with the React-based UI.
- **Performance**: Large notebooks currently render all cells. Virtualization and range rendering are potential future optimizations.
- **Rich outputs**: Rich output rendering depends on the preload service and webview coordination. Widget providers must cooperate with the webview lifecycle management.
- **Testing**: Coverage spans configuration, resolver behavior, and core flows. New features should include corresponding unit and end-to-end tests.
