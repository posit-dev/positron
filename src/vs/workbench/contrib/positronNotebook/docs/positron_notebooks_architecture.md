# Positron Notebooks: Implementation Architecture

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Quick Start for Contributors](#quick-start-for-contributors)
3. [Practical Development Guides](#practical-development-guides)
4. [Architecture Overview](#architecture-overview)
5. [System Components](#system-components)
6. [Accessibility Implementation](#accessibility-implementation)
7. [Kernel Protocol and Integration](#kernel-protocol-and-integration)
8. [Positron Service Integrations](#positron-service-integrations)
9. [Testing and Debugging](#testing-and-debugging)
10. [Performance Optimization](#performance-optimization)
11. [File Organization](#file-organization)
12. [Current Status and Considerations](#current-status-and-considerations)

## Executive Summary

Positron Notebooks is a feature-flagged notebook editor that ships alongside the standard VS Code notebook experience. When `positron.notebook.enabled` is true the editor registers as an optional handler for `.ipynb` resources while continuing to reuse VS Code's notebook models, kernel selection, execution, and working copy services. The user interface is implemented in React through `PositronNotebookEditor`, `PositronNotebookInstance`, and a set of observable-backed cell components. The implementation coexists with the built-in notebook editor: users can opt into Positron via `Open With…` or by configuring an editor association, and the feature can be disabled without impacting the standard experience.

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
Alternatively you can right click a notebook `Open With…` -> `Configure Default editor...` -> `Positron Notebook` to avoid messing with json.

Without this association the Positron editor remains available in the `Open With…` menu.

3. Open or create an `.ipynb`. The resolver constructs a `PositronNotebookEditorInput`, resolves the backing notebook model, and instantiates `PositronNotebookEditor`.

Remove the feature flag (and association if set) to fall back to the standard VS Code notebook editor.

### Key files to understand

- `src/vs/workbench/contrib/positronNotebook/browser/positronNotebookExperimentalConfig.ts` – feature flag definition and registration.
- `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts` – editor registration, cell URI resolver, working copy handler, and command wiring.
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput.ts` – VS Code `EditorInput` that resolves notebook models and owns a `PositronNotebookInstance`.
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` – central state manager (cells, kernel selection, runtime session, selection machine, context keys).
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor.tsx` – `AbstractEditorWithViewState` implementation that renders the React tree.
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorControl.ts` – `ICompositeCodeEditor` adapter surfaced through `getControl()` so shared features (inline chat, debugging) can reach the active cell editor.
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx` and `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/*` – React view hierarchy, cell wrappers, action bars, and output rendering.
- `src/vs/workbench/contrib/positronNotebook/browser/ContextKeysManager.ts` and `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/useCellContextKeys.ts` – notebook and cell scoped context keys that drive commands and toolbar affordances.
- `src/vs/workbench/contrib/positronNotebook/browser/selectionMachine.ts` – finite-state selection machine shared between the instance and UI.
- `src/vs/workbench/services/positronNotebook/browser/positronNotebookService.ts` – global registry for active notebook instances.
- `src/vs/workbench/contrib/runtimeNotebookKernel/browser/runtimeNotebookKernel.ts` – runtime-backed kernel implementation used by Positron notebooks.

## Practical Development Guides

## Architecture Overview

Core design principles:

1. **Feature flagged** – all contributions check `positron.notebook.enabled`, allowing the editor to ship disabled by default.
2. **Parallel implementation** – registration priority is `RegisteredEditorPriority.option`; the built-in editor remains the default unless the user opts in.
3. **Shared infrastructure** – notebook models, kernel discovery, execution, diffing, and working copy management all use VS Code services.
4. **Observable state + React view** – notebook state lives in observables on `PositronNotebookInstance`, consumed via `useObservedValue`.
5. **Context-key driven UX** – notebook and cell behaviours (command availability, toolbar icons) are controlled through scoped context keys.
6. **Explicit selection machine** – `SelectionStateMachine` governs focus, editing, and multi-select states consistently across the UI and command layer.
7. **Action registry** – cell toolbars and menus are sourced from `NotebookCellActionBarRegistry` so contributions can add actions declaratively.

## System Components

### Configuration layer

- `positronNotebookExperimentalConfig.ts` registers the `positron.notebook.enabled` setting (machine-overridable, hidden, defaults to `false`).
- `workbench.editorAssociations` remains the mechanism for making Positron the default `.ipynb` editor. `usingPositronNotebooks()` in `common/positronNotebookCommon.ts` encapsulates the check.

### Editor registration and resolution

`positronNotebook.contribution.ts` only registers editors when the feature flag is enabled:

```typescript
if (checkPositronNotebookEnabled(configurationService)) {
	editorResolverService.registerEditor('*.ipynb', notebookEditorInfo, { ... }, { createEditorInput: ... });
	editorResolverService.registerEditor(`${Schemas.vscodeNotebookCell}:/**/*.ipynb`, { ...priority: RegisteredEditorPriority.exclusive }, ...);
}
```

Key responsibilities:

- Registers `PositronNotebookEditor` as an optional handler for `.ipynb` resources and for `vscode-notebook-cell` URIs.
- Provides `createUntitledEditorInput` support for untitled notebooks.
- Registers `PositronNotebookWorkingCopyEditorHandler` so backup restoration rehydrates Positron editors.
- Registers an editor serializer (`PositronNotebookEditorSerializer`) for hot-exit scenarios.
- Installs notebook-level and cell-level commands (`registerNotebookAction`, `registerCellCommand`), including execution controls, selection navigation, and markdown toggles.
- Adds the `ExecuteSelectionInConsoleAction`, surfacing notebook selection execution in the console.

### Core architecture components

#### PositronNotebookEditorInput (`browser/PositronNotebookEditorInput.ts`)

- Caches a `PositronNotebookInstance` via `PositronNotebookInstance.getOrCreate`.
- Resolves notebook models through `INotebookEditorModelResolverService`.
- Implements save / revert / dirty state using VS Code working copy APIs.
- Annotates each input with a `uniqueId` for tracing and sets `viewType` to `jupyter-notebook`.

#### PositronNotebookInstance (`browser/PositronNotebookInstance.ts`)

- Singleton per notebook URI (`ResourceMap` backed `_instanceMap`).
- Observables:
  - `cells` – array of `IPositronNotebookCell`.
  - `runtimeSession` – current `ILanguageRuntimeSession`.
  - `kernel` / `kernelStatus` – current `INotebookKernel` selection (connected/disconnected at present).
  - `language` – derived from the selected kernel.
- Integrates with:
  - `INotebookExecutionService` & `INotebookExecutionStateService` for execution.
  - `INotebookKernelService` for kernel selection and tracking.
  - `IRuntimeSessionService` events to keep the runtime session observable in sync.
  - `IPositronWebviewPreloadService` for rich outputs.
  - `IPositronConsoleService` for console interactions and clipboard operations.
  - `PositronNotebookContextKeyManager` and `SelectionStateMachine`.
- Manages view attachment/detachment, keyboard navigation (Enter/Escape), cell syncing (`_syncCells` reuses existing cell instances when possible), and clipboard actions. This is where most logic that is not directly UI goes.


#### PositronNotebookService (`services/positronNotebook/browser/positronNotebookService.ts`)

- Global registry for active `IPositronNotebookInstance` objects.
- Provides `getActiveInstance`, lookup by URI, and `usingPositronNotebooks()` (delegates to `workbench.editorAssociations`).


#### PositronNotebookEditor (`browser/PositronNotebookEditor.tsx`)

- Extends `AbstractEditorWithViewState<INotebookEditorViewState>`.
- Provides view-state persistence keyed by notebook URI.
- Creates a `PositronNotebookEditorControl` before delegating to the base `setInput`.
- Renders the React tree via `PositronReactRenderer`, wrapping the app with:
  - `NotebookVisibilityProvider` (`observableValue<boolean>`).
  - `NotebookInstanceProvider` (instance context).
  - `EnvironmentProvider` (editor size, scoped context key factory).
- Cleans up scoped context keys and the React renderer on dispose.

#### PositronNotebookEditorControl (`browser/PositronNotebookEditorControl.ts`)

- Implements `ICompositeCodeEditor`.
- Tracks the selected cell via an `autorun` on the selection machine and exposes the active cell's `ICodeEditor`.
- Enables shared workbench features (e.g. inline chat, debug UI) that rely on `getControl().activeCodeEditor`.


#### Context key management

- `PositronNotebookContextKeyManager` scopes notebook-level keys (container focused vs. editor focused).
- `POS...` constants in `ContextKeysManager.ts` define per-cell keys (isCode, isRunning, markdown editor open, etc.).
- `CellContextKeyServiceProvider` and `useCellContextKeys` bind these keys to each cell's DOM subtree so `registerCellCommand` when-clauses work as expected.

#### Webview preload integration

- `PositronNotebookInstance` registers itself with `IPositronWebviewPreloadService`.
- `PositronNotebookCodeCell` inspects outputs, determines preload needs via `getWebviewMessageType`, and claims outputs through the preload service.
- `hooks/useWebviewMount.ts` coordinates mounting `INotebookOutputWebview`s, claiming/releasing them on visibility changes, and limiting height via `MAX_OUTPUT_HEIGHT`.

#### Execution services & kernel selection

- `PositronNotebookInstance._runCells` cancels running executions if re-triggered and delegates to `INotebookExecutionService.executeNotebookCells`.
- Kernel selection uses `INotebookKernelService.getMatchingKernel` and persists `viewState.selectedKernelId` when available.
- `RuntimeNotebookKernel` implements `INotebookKernel`, orchestrates runtime startup (`IRuntimeStartupService`), and ensures sequential execution through `NotebookExecutionQueue`.

### Cell architecture

```
IPositronNotebookCell
└─ PositronNotebookCellGeneral
   ├─ PositronNotebookCodeCell
   └─ PositronNotebookMarkdownCell
```

Key pieces:

- `PositronNotebookCellGeneral` provides shared behaviour (execution observables, container/editor attachment, selection helpers).
- `PositronNotebookCodeCell` parses outputs (`parseOutputData`, `pickPreferredOutputItem`), integrates with the preload service, and exposes execution metadata (duration, order, success).
- `PositronNotebookMarkdownCell` renders markdown using `Markdown.tsx` (with `DeferredImage` for local assets).
- React layer:
  - `NotebookCellWrapper` handles focus, screen-reader announcements, per-cell context keys, and delegates to `NotebookCellActionBar`.
  - `CellEditorMonacoWidget` owns the Monaco editor embedding, synchronises layout, and forwards focus events.
  - `CellLeftActionMenu` + `ExecutionStatusBadge` + `CellExecutionInfoPopup` show execution progress and provide execution commands.
  - `NotebookCellActionBar` sources actions from `NotebookCellActionBarRegistry` (`useActionsForCell` filters by context).
  - `AddCellButtons` inserts quick actions between cells.
  - `KernelStatusBadge` surfaces kernel state in the toolbar.

### Selection state management (`browser/selectionMachine.ts`)

- Encapsulates all the logic related to cell selection. E.g. selecting a cell, moving selection up or down, multi-selection, etc..
- Defines `SelectionState` variants: `NoSelection`, `SingleSelection`, `MultiSelection`, `EditingSelection`.
- Supports keyboard navigation (arrow keys, Shift+arrow), editor entry/exit, and selection toggling.
- `PositronNotebookInstance` listens for selection changes to keep context keys accurate and to set the notebook container focus state.

### Startup and integration flow

1. Feature flag check via `checkPositronNotebookEnabled`.
2. `IEditorResolverService` chooses Positron when configured or when explicitly requested.
3. `PositronNotebookEditorInput.getOrCreate` retrieves/creates an instance and resolves the notebook model (including untitled support).
4. `PositronNotebookEditor` initialises the editor control, renders the React tree, and attaches the instance to the DOM with a scoped context key service.
5. Cell components attach to the instance, establish context keys, and begin observing state.
6. Kernel selection is hydrated from view state or suggestions; runtime session events wire up via observables.
7. Working copy integration ensures dirty state/backup handling through `PositronNotebookWorkingCopyEditorHandler`.

### Integration with VS Code systems

- Notebook services: `INotebookService`, `INotebookEditorModelResolverService`, `INotebookKernelService`, `INotebookExecutionService`, `INotebookExecutionStateService`.
- Editor platform: `IEditorResolverService`, `IEditorPaneRegistry`, `IEditorFactoryRegistry`, `IWorkingCopyEditorService`.
- Command and keybinding infrastructure: `registerNotebookAction`, `registerCellCommand`, `executeIcon`, context expressions from `ContextKeyExpr`.
- Runtime services: `IRuntimeSessionService`, `ILanguageRuntimeService`, `IRuntimeStartupService`, `IPositronConsoleService`, `IPositronWebviewPreloadService`.

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

### Current accessibility features

- **Keyboard navigation**: Arrow keys and Shift+arrow are wired through `registerNotebookAction`. `PositronNotebookInstance` handles Enter/Escape to enter/exit edit mode.
- **Focus management**: `NotebookCellWrapper` sets `tabIndex`, `aria-label`, and `aria-selected`; focus automatically returns to the cell container when leaving edit mode.
- **Screen reader announcements**:
  - Per-cell (`NotebookCellWrapper`) announcements for selection and editing via `ScreenReaderOnly`.
  - Notebook-level announcements (`PositronNotebookComponent`) for cell insertion/removal counts.
  - Execution status updates expose `role="status"` with `aria-live="polite"` in `CellLeftActionMenu`.
- **Accessible outputs**: `DeferredImage` provides `aria-label` when loading or failing to convert images; text outputs are rendered as semantic HTML.
- **Kernel state**: `KernelStatusBadge` surfaces connection status textually.

## Kernel Protocol and Integration

- `PositronNotebookInstance` selects kernels via `INotebookKernelService.selectKernelForNotebook`, falling back to suggestions when no explicit choice exists.
- `RuntimeNotebookKernel` implements VS Code's `INotebookKernel`:
  - Starts runtime sessions through `IRuntimeStartupService` / `IRuntimeSessionService`.
  - Serialises execution with `NotebookExecutionQueue`.
  - Emits execution telemetry via `_didExecuteCodeEmitter` for downstream services (variables, console).
- Execution flow:

```typescript
async executeNotebookCellsRequest(notebookUri: URI, cellHandles: number[]): Promise<void> {
	const notebook = _notebookService.getNotebookTextModel(notebookUri);
	let session = _runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
	if (!session) {
		await ensureSessionStarted(...);
		session = _runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
	}
	_notebookExecutionSequencer.enqueue(notebookUri, cellHandles, execution => execution.start(...));
}
```

- Cancellation is forwarded to `INotebookExecutionService.cancelNotebookCells`.
- `ExecuteSelectionInConsoleAction` reuses the runtime session associated with the notebook to run ad-hoc code in the console.

## Positron Service Integrations

- **Runtime session service (`IRuntimeSessionService`)** – lifecycle of interpreter sessions, events consumed by `PositronNotebookInstance`.
- **Console service (`IPositronConsoleService`)** – shared console integration (execution of selections, output display).
- **Webview preload service (`IPositronWebviewPreloadService`)** – coordinates widget and rich output messaging.
- **Plots & data explorer (`IPositronPlotsService`, `mainThreadLanguageRuntime`)** – runtime events update the plots and variables panels.
- **Notebook service (`IPositronNotebookService`)** – tracks active notebooks for other Positron UI (e.g. `KernelStatusBadge` host).

## Testing and Debugging

### Test coverage

We have more e2e tests than unit tests due to the end product being a very visual system.

- **End-to-end tests** (`test/e2e/tests/notebook`)
- **Unit tests** (`src/vs/workbench/contrib/positronNotebook/test/browser`)

### Debugging strategies

- Use `ILogService` messages emitted from `PositronNotebookEditorInput`, `PositronNotebookInstance`, and `RuntimeNotebookKernel` to trace lifecycle events (constructor, attachView, execution).
- Inspect `NotebookCellActionBarRegistry` if toolbar actions fail to appear; verify context keys and `when` clauses.
- Webview issues: enable `webviewDeveloperTools` and inspect messages emitted via `useWebviewMount`.
- Selection / focus bugs: log the `SelectionStateMachine.state` observable and confirm `PositronNotebookContextKeyManager` updates the container focus key.


## File Organization

```
src/vs/workbench/contrib/positronNotebook/
├── browser/
│   ├── positronNotebookExperimentalConfig.ts
│   ├── positronNotebook.contribution.ts
│   ├── ExecuteSelectionInConsoleAction.ts
│   ├── KernelStatusBadge.tsx
│   ├── PositronNotebookEditorInput.ts
│   ├── PositronNotebookEditor.tsx
│   ├── PositronNotebookEditorControl.ts
│   ├── PositronNotebookInstance.ts
│   ├── PositronNotebookComponent.tsx
│   ├── NotebookInstanceProvider.tsx
│   ├── EnvironmentProvider.tsx
│   ├── NotebookVisibilityContext.tsx
│   ├── useObservedValue.tsx / useDisposableStore.tsx
│   ├── PositronNotebookCells/
│   │   ├── IPositronNotebookCell.ts
│   │   ├── PositronNotebookCell.ts
│   │   ├── PositronNotebookCodeCell.ts
│   │   ├── PositronNotebookMarkdownCell.ts
│   │   └── createNotebookCell.ts
│   └── notebookCells/
│       ├── NotebookCodeCell.tsx / NotebookMarkdownCell.tsx
│       ├── NotebookCellWrapper.tsx
│       ├── CellEditorMonacoWidget.tsx
│       ├── CellLeftActionMenu.tsx
│       ├── CellExecutionInfoPopup.tsx
│       ├── ExecutionStatusBadge.tsx
│       ├── NotebookCellActionBar.tsx and actionBar/*
│       ├── DeferredImage.tsx
│       ├── PreloadMessageOutput.tsx
│       └── hooks/useWebviewMount.ts
├── common/
│   └── positronNotebookCommon.ts
├── docs/
│   └── positron_notebooks_architecture.md
└── test/
    └── browser/
        ├── positronNotebookConfigurationHandling.test.ts
        ├── positronNotebookEditorResolution.test.ts
        └── testUtils.ts
```

Related services:

```
src/vs/workbench/services/positronNotebook/browser/positronNotebookService.ts
src/vs/workbench/contrib/runtimeNotebookKernel/browser/runtimeNotebookKernel*.ts
```

## Current Status and Considerations

- The feature flag defaults to off; enabling requires a restart because contributions register during workbench startup.
- Positron notebooks support `.ipynb` view type (`jupyter-notebook`). Diffing still delegates to VS Code's built-in diff editor.
- Untitled notebooks are supported through the resolver and working copy handler.
- Extension compatibility: kernel-level extensions continue to work (shared kernel APIs), but DOM-dependent notebook extensions will not integrate with the React UI.
- Large notebooks render all cells; virtualization and range rendering remain future work.
- Rich outputs depend on the preload service and overlay webviews; ensure widget providers cooperate with `useWebviewMount`.
- Testing coverage spans configuration, resolver behaviour, and core flows, but new features should add corresponding unit / E2E tests.
