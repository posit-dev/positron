---
date: 2026-01-27T17:07:11-05:00
researcher: Claude
git_commit: 7a393f06efe296b15779bca12d9df3ef05d9bf6e
branch: main
repository: positron
topic: "Drag-and-drop options for Positron notebook cell reordering"
tags: [research, codebase, notebooks, drag-and-drop, ui, dependencies]
status: complete
last_updated: 2026-01-27
last_updated_by: Claude
last_updated_note: "Added follow-up research on security history, UX comparison, and bundled ESM approach"
---

# Research: Drag-and-Drop Options for Positron Notebook Cell Reordering

**Date**: 2026-01-27T17:07:11-05:00
**Researcher**: Claude
**Git Commit**: 7a393f06efe296b15779bca12d9df3ef05d9bf6e
**Branch**: main
**Repository**: positron

## Research Question

We need to add drag-and-drop to reorder cells in Positron notebooks. This behavior is critical to get smooth and best-in-class. There are external drag-and-drop libraries for React that work great but it is _very_ hard to justify external dependencies in this project. Can you help me figure out what our options are for creating a high performance and beautiful drag-and-drop experience? Things like the browser API that just takes a picture of the element and drags that around looks bad and dated. Look at what other drag-and-drop systems do in Positron currently along with researching the internet for other options. If it really is best to bring in an external dependency we need to justify it very strongly. We can't just add to a package.json here due to how assets are bundled so things like security bugs that need to be rapidly patched are a big no-no.

## Summary

Positron has extensive drag-and-drop infrastructure inherited from VS Code, with sophisticated implementations for editor tabs, file explorer, and VS Code notebooks. The Positron notebook implementation uses React components but currently only supports keyboard-based cell reordering (Alt+Up/Down). Three viable options exist for adding drag-and-drop:

1. **Reuse VS Code's existing drag-and-drop infrastructure** - Adapt the base list/tree DnD classes already in the codebase
2. **Implement custom React-based solution using pointer events** - Full control without external dependencies
3. **Add @dnd-kit/core as external dependency** - Modern, performant library with 7.5M weekly downloads

Given Positron's dependency constraints and existing infrastructure, **Option 1 (reusing VS Code's DnD classes)** provides the best balance of performance, maintainability, and risk.

## Detailed Findings

### Current Positron Notebook State

The Positron notebook (`src/vs/workbench/contrib/positronNotebook/`) is a React-based reimplementation that differs significantly from VS Code's notebook:

- **Cell Rendering**: React components (`NotebookCodeCell.tsx`, `NotebookMarkdownCell.tsx`) instead of DOM templates
- **Selection Management**: Custom `SelectionStateMachine` with observable state
- **Cell Reordering**: Currently keyboard-only via `moveCellsUp()`/`moveCellsDown()` methods
- **Placeholder for DnD**: `moveCells()` method at `PositronNotebookInstance.ts:1375-1382` marked as "TODO: to be completed in Step 3 (Drag & Drop)"

### Existing Drag-and-Drop Infrastructure in Positron

#### Core DnD Classes (Reusable)

**Base Infrastructure** (`src/vs/base/browser/`):
- `dnd.ts` - Core utilities: `DelayedDragHandler`, `IDragAndDropData` interface
- `ui/list/list.ts` - `IListDragAndDrop<T>` interface with full DnD lifecycle
- `ui/tree/tree.ts` - `ITreeDragAndDrop<T>` for hierarchical structures

**Platform Services** (`src/vs/platform/dnd/browser/dnd.ts`):
- `LocalSelectionTransfer` - Manages drag data within the application
- `DragAndDropContributionRegistry` - Extensible DnD handling

#### Implementations Currently in Use

| Component | Implementation | Key Features |
|-----------|---------------|--------------|
| **VS Code Notebooks** | `cellDnd.ts:55-420` | Full cell reordering with insertion indicators |
| **Editor Tabs** | `multiEditorTabsControl.ts` | Tab reordering with drop zones |
| **File Explorer** | `FileDragAndDrop` class | Multi-file selection and movement |
| **Terminal Tabs** | `terminalTabsList.ts` | Terminal reordering |
| **View Panes** | `ViewPaneDropOverlay` | Pane rearrangement |

#### VS Code Notebook DnD Analysis

The VS Code implementation (`src/vs/workbench/contrib/notebook/browser/view/cellParts/cellDnd.ts`) provides:

**Drag Preview Creation**:
```typescript
// Creates custom drag image with syntax highlighting
const dragImage = dragImageProvider();
event.dataTransfer.setDragImage(dragImage, 0, 0);
setTimeout(() => dragImage.remove(), 0); // Cleanup after browser captures
```

**Insertion Indicator**:
- Visual line showing drop position
- CSS: 2px height, absolute positioning
- Updates based on cursor position ratio within cell (top 50% = above, bottom 50% = below)

**Performance Optimizations**:
- 200ms scroll debouncing during drag
- GPU-accelerated CSS transforms for indicator
- Early exit when dragging over same cell
- Auto-scroll with proportional speed near edges

### Modern Web Drag-and-Drop Landscape

#### Native HTML5 API Limitations

| Issue | Impact on User Experience |
|-------|---------------------------|
| Screenshot-based preview | Looks dated, cannot be styled during drag |
| No mobile support | Touch devices require separate implementation |
| Text selection conflicts | `draggable="true"` breaks normal selection |
| Mandatory preventDefault | Drop fails without specific handler pattern |
| Data access restrictions | Can only read drag data at start/end |

#### Modern Library Comparison

| Library | Weekly Downloads | Pros | Cons for Positron |
|---------|-----------------|------|-------------------|
| **@dnd-kit/core** | 7.5M | GPU-accelerated, accessible, tiny core (11KB) | External dependency |
| **Pragmatic DnD** | 567K | From Atlassian, 4.7KB core, framework agnostic | New, less mature |
| **react-dnd** | 3.2M | Mature, flexible backend system | Complex API, 4 years since update |
| **react-beautiful-dnd** | 1.9M | N/A - ARCHIVED | Do not use |

#### Custom Implementation Pattern

For full control without dependencies:
```javascript
class DragController {
  onMouseDown(event) {
    // Calculate offset to prevent jump
    // Switch to absolute positioning
    // Listen on document for faster-than-element movement
    document.addEventListener('mousemove', this.onMouseMove);
  }

  onMouseMove(event) {
    // Use transform for GPU acceleration
    element.style.transform = `translate(${x}px, ${y}px)`;
    // Detect drop targets with elementFromPoint
  }
}
```

### Dependency Management Constraints in Positron

#### Complex Multi-Layer System

- **60+ package.json files** across different directories
- **Sequential installation** required for parent directories
- **Webpack bundling** for extensions with explicit externals
- **Native module compilation** against Electron (v37.7.0) and Node.js (v22.22.0)
- **No automated npm security monitoring** via Dependabot

#### Adding External Dependencies Requires:

1. Modification to appropriate `package.json`
2. Update `build/npm/dirs.js` if new directory
3. Configure webpack externals to prevent bundling
4. Update `cgmanifest.json` for license compliance
5. Consider patch-package for urgent fixes
6. Manual security monitoring and updates

### Architecture Documentation

#### Positron-Specific Patterns

**Observable State Management**:
- Cells managed as observable array (`PositronNotebookInstance.ts:1596-1658`)
- Selection state machine with discriminated unions
- React components use `useObservedValue` hooks

**Cell Lifecycle**:
```typescript
NotebookCellTextModel → IPositronNotebookCell → React Component
         ↓                      ↓                     ↓
   VS Code Model         Observable Wrapper    UI Representation
```

**Command Registration** (`positronNotebook.contribution.ts:1143-1192`):
- Actions extend `NotebookAction2` base class
- Keybindings via `registerAction2`
- Context keys for conditional enablement

### Options Analysis

#### Option 1: Reuse VS Code's DnD Infrastructure

**Implementation Path**:
1. Create React wrapper around `IListDragAndDrop` interface
2. Implement drag handle registration in cell components
3. Use existing `DelayedDragHandler` for drag initiation
4. Adapt insertion indicator pattern from VS Code notebooks

**Pros**:
- No external dependencies
- Proven in production with VS Code notebooks
- Consistent with rest of codebase
- Already handles accessibility, performance optimizations

**Cons**:
- Requires adapting DOM-based system to React
- May need custom preview rendering for React components

#### Option 2: Custom React Implementation

**Implementation Path**:
1. Use pointer events (not HTML5 drag API)
2. Create drag preview with React portal
3. GPU-accelerated transforms for smooth movement
4. Custom drop zone detection

**Pros**:
- Full control over behavior and styling
- No external dependencies
- Native React patterns

**Cons**:
- Significant development effort
- Need to reimplement accessibility
- Risk of missing edge cases VS Code handles

#### Option 3: Add @dnd-kit/core

**Implementation Path**:
1. Add to `extensions/positronNotebook/package.json`
2. Configure as webpack external
3. Use `DragOverlay` for custom previews
4. Implement with hooks and context

**Pros**:
- Modern, performant (60fps with 10,000 items)
- Accessible by default
- Small core (11KB)
- Active maintenance

**Cons**:
- External dependency requiring security monitoring
- Increases bundle size
- Inconsistent with other Positron DnD implementations

## Code References

- `src/vs/workbench/contrib/positronNotebook/PositronNotebookInstance.ts:1375` - Placeholder for cell drag implementation
- `src/vs/workbench/contrib/notebook/browser/view/cellParts/cellDnd.ts:55` - VS Code notebook DnD controller
- `src/vs/base/browser/dnd.ts:81` - Core DnD utilities available for reuse
- `src/vs/base/browser/ui/list/list.ts:189` - List DnD interface pattern
- `src/vs/workbench/browser/positronComponents/positronModalDialog/components/draggableTitleBar.tsx:14` - Example of custom drag in Positron React component

## Recommendation

**Use Option 1: Adapt VS Code's existing DnD infrastructure** for the following reasons:

1. **Consistency**: Matches patterns used throughout the codebase
2. **Risk Mitigation**: No external dependencies to monitor
3. **Performance**: Already optimized with debouncing, GPU acceleration
4. **Completeness**: Handles edge cases like scroll, multi-selection, copy vs move
5. **Maintenance**: Easier to maintain code that follows established patterns

The main implementation challenge will be bridging the DOM-based system with React components, but this can be solved with:
- React refs for DOM element access
- Effect hooks for drag handle registration
- Portal for custom drag preview rendering
- Observable state updates for drop operations

This approach provides a "best-in-class" experience without the dependency management overhead that makes external libraries problematic for this project.

---

## Follow-up Research: Security, UX, and Bundled ESM Approach

### Security History of DnD Libraries

Research into CVE databases, GitHub Security Advisories, and Snyk found:

| Library | Direct CVEs | Notes |
|---------|-------------|-------|
| @dnd-kit/core | **0** | Cleanest profile |
| react-dnd | **0** | Has undisclosed report that was never acted on |
| react-beautiful-dnd | **0** | Deprecated - no future patches |
| pragmatic-drag-and-drop | **0** | Cleanest profile |

**Key finding**: Drag-and-drop libraries have essentially **zero security vulnerability history**. The "vulnerabilities" in databases are actually:
- Typosquatting attacks (fake packages with similar names)
- Transitive dependencies (build tools, not the libraries)
- CSP compatibility issues (not security bugs)

**Why low risk**: These libraries operate on DOM with user-initiated events only, don't parse untrusted data, don't make network requests, and don't execute arbitrary code.

### UX Comparison: VS Code vs Modern Libraries

| Feature | VS Code Notebook | Modern Libraries (dnd-kit) |
|---------|------------------|---------------------------|
| Drag preview | Custom DOM clone | DragOverlay component |
| Drop indicator | 2px line, instant show/hide | Same capability |
| **Items shift during drag** | **No** | **Yes - key differentiator** |
| **Drop animation** | **None - instant snap** | **Physics-based spring** |
| Activation delay | None | Configurable (distance/time) |
| Keyboard support | Alt+Up/Down only | Full keyboard drag |
| Auto-scroll | Yes | Yes |

**The key UX gap**: Modern libraries make other items **smoothly animate out of the way** as you drag, providing continuous visual feedback. VS Code's approach shows a static line indicator, then items teleport on drop.

### Bundled ESM Approach (Recommended)

Positron already uses this pattern for React and react-window:

```
src/esm-package-dependencies/
├── react.js                    # Entry point
├── stable/react@18.3.1/        # Bundled, minified React (~9 KB)
└── v135/react-window@1.8.10/   # Bundled react-window (~24 KB)
```

**For dnd-kit, same approach**:
- Download minified ESM bundles from esm.sh
- Rewrite imports to local paths
- Add to import map in workbench.html
- Total: ~53 KB (comparable to react-window)

**Advantages over source vendoring**:
- Follows existing patterns exactly
- Single minified files, not 43 source files
- Source maps available for debugging
- Easy to update (re-download, re-patch imports)

### Revised Recommendation

Given the follow-up research:

1. **Security risk is minimal** - No CVE history for dnd-kit
2. **UX gap is significant** - "Items shift out of the way" animation is the key differentiator
3. **Bundled ESM is the right pattern** - Matches React, react-window handling

**Recommendation: Add @dnd-kit via bundled ESM approach**

This provides:
- Best-in-class drag experience (items shift, physics animations)
- No npm dependency management overhead
- Consistent with existing Positron patterns
- ~53 KB footprint (acceptable)
- Minimal security risk

See `thoughts/shared/research/2026-01-27-dnd-kit-integration-draft.md` for detailed implementation files.