# Positron Data Explorer Frontend Context

This prompt provides context for working with the Positron Data Explorer frontend components and architecture.

## Architecture Overview

The Data Explorer is organized into three main layers:
- **Services**: Backend communication and data management
- **Editor**: Integration with VS Code editor system
- **Browser UI**: React components and user interface

## Core Directory Structure

### Services Layer
`src/vs/workbench/services/positronDataExplorer/`
- **`browser/`** - Service implementations and data grid instances
  - `components/` - Cell renderers (columnSummaryCell, tableDataCell, columnProfile*, vectorHistogram, etc.)
  - `interfaces/` - TypeScript interfaces for services
  - `positronDataExplorerService.ts` - Main service implementation
  - `tableDataDataGridInstance.tsx` - Data table grid logic
  - `tableSummaryDataGridInstance.tsx` - Summary/profiling grid logic
- **`common/`** - Shared utilities and caching
  - `*Cache.ts` - Various caching implementations
  - `constants.ts` - Configuration constants
  - `utils.ts` - Utility functions

### Editor Integration
`src/vs/workbench/contrib/positronDataExplorerEditor/`
- **`browser/`** - VS Code editor contribution
  - `positronDataExplorerEditor.tsx` - Main editor component
  - `positronDataExplorerEditorInput.ts` - Editor input handling
  - `positronDataExplorerActions.ts` - Command actions
  - `positronDataExplorerContextKeys.ts` - Context key definitions

### UI Components
`src/vs/workbench/browser/positronDataExplorer/`
- **`positronDataExplorer.tsx`** - Top-level component
- **`components/`** - UI component tree
  - `actionBar/` - Toolbar components
  - `dataExplorerPanel/` - Main panel with data grid
    - `components/dataExplorer.tsx` - Core data exploration view
    - `components/addEditRowFilterModalPopup/` - Filtering UI
    - `components/rowFilterBar/` - Filter display bar
    - `components/statusBar.tsx` - Status indicators
  - `dataExplorerClosed/` - Disconnected state view

### Data Grid Foundation
`src/vs/workbench/browser/positronDataGrid/`
- **`positronDataGrid.tsx`** - Reusable data grid component
- **`components/`** - Grid building blocks
  - `dataGridRow.tsx`, `dataGridColumnHeaders.tsx` - Grid structure
  - `dataGridScrollbar.tsx` - Custom scrolling
- **`classes/dataGridInstance.tsx`** - Grid instance management

## Key Communication Interface

**Language Runtime Communication**
`src/vs/workbench/services/languageRuntime/common/positronDataExplorerComm.ts`
- Defines RPC protocol for backend communication
- Column schemas, data requests, filtering, profiling

## Main Components

- **positronDataExplorer.tsx** - Top-level data explorer wrapper
- **dataExplorer.tsx** - Core data viewing component with grid
- **columnSummaryCell.tsx** - Column profiling and statistics display
- **tableDataCell.tsx** - Individual cell rendering with formatting
- **positronDataGrid.tsx** - Virtualized grid component

## Testing

### End-to-End Tests
```bash
npx playwright test data-explorer --project e2e-electron
```

Test files located in `test/e2e/tests/data-explorer/`

For detailed testing context, see `.claude/e2e-testing.md`

## Component Architecture

The Data Explorer follows a hierarchical component structure:
```
positronDataExplorer
├── actionBar (toolbar)
├── dataExplorerPanel
│   ├── rowFilterBar (active filters)
│   ├── dataExplorer (main grid view)
│   └── statusBar (connection status)
└── dataExplorerClosed (disconnected state)
```

Data flows from language runtime backends through the service layer to the UI components, with caching and state management handled at the service level.