# Windows File Path Auto-Conversion Feature

## Overview

This PR implements automatic file path conversion when pasting files (copied from file manager) into R contexts, matching RStudio's behavior exactly. When users copy files from Windows Explorer and paste into Positron's R console or editor, paths are automatically converted to R-compatible format.

**GitHub Issue**: https://github.com/posit-dev/positron/issues/8393

## Problem Statement

RStudio users expect Windows file paths to be automatically converted when pasting **files** (not text paths) into R contexts. This feature bridges the gap between file manager operations and data analysis workflows.

## Behavior

### What Gets Converted ✅
**File clipboard content** (copied from file manager):
- **Single file**: `"C:/Users/file.txt"`
- **Multiple files**: `c("C:/Users/file1.txt", "C:/Users/file2.txt")`
- **Files with spaces**: `"C:/Users/My Documents/file.txt"`
- **Files with quotes**: `"C:/Users/My \"Special\" File.txt"` (properly escaped)

### What Doesn't Get Converted ❌
- **UNC paths**: `\\server\share\file.txt` (skipped entirely for safety)
- **Text paths**: `C:\Users\file.txt` typed as text (not file clipboard)
- **Mixed scenarios**: If any UNC paths detected, skip conversion for all files
- **Non-R contexts**: Python console, other languages (unaffected)

### Key Features
- **RStudio compatible**: Matches `formatDesktopPath()` behavior exactly
- **Safe UNC handling**: Uses VS Code's `isUNC()` to detect and skip network paths
- **User controllable**: `positron.r.autoConvertFilePaths` setting (defaults enabled)
- **Platform agnostic**: Works on any OS, detects file clipboard via `text/uri-list`
- **Universal string formatting**: Quote escaping works for any programming language

## Architecture

**3-Layer Design** maintaining clean separation of concerns:

### 1. Core Layer (Language-Agnostic)
**File**: `src/vs/workbench/contrib/positronPathUtils/common/filePathConverter.ts`

```typescript
export function convertClipboardFiles(dataTransfer: DataTransfer): string[] | null {
    // Check for file URI list from clipboard
    const uriList = dataTransfer.getData('text/uri-list');
    if (uriList) {
        const fileUris = uriList.split('\n')
            .filter(line => line.trim().startsWith('file://'));

        filePaths = fileUris.map(uri => {
            // Convert file URIs using VS Code's proper URI handling
            return URI.parse(uri.trim()).fsPath;
        });
    }

    // Skip conversion entirely if ANY paths are UNC paths
    const hasUncPaths = filePaths.some(path => isUNC(path));
    if (hasUncPaths) {
        return null;
    }

    return filePaths.map(formatForwardSlashPath);
}

function formatForwardSlashPath(filePath: string): string {
    // Convert backslashes to forward slashes (universal need)
    const normalized = toSlashes(filePath);

    // Escape existing quotes (universal for string literals)
    const escaped = normalized.replace(/"/g, '\\"');

    // Wrap in quotes for safe usage (universal for paths with spaces)
    return `"${escaped}"`;
}
```

### 2. API Layer (Official Positron Extension API)
**Files**: `src/positron-dts/positron.d.ts` + implementation

```typescript
namespace paths {
    /**
     * Extract file paths from clipboard for use in data analysis code.
     */
    export function extractClipboardFilePaths(dataTransfer: vscode.DataTransfer): Thenable<string[] | null>;
}
```

### 3. Language Layer (R-Specific)
**File**: `extensions/positron-r/src/languageFeatures/rFilePasteProvider.ts`

```typescript
export class RFilePasteProvider implements vscode.DocumentPasteEditProvider {
    async provideDocumentPasteEdits(...) {
        const filePaths = await positron.paths.extractClipboardFilePaths(dataTransfer);
        if (!filePaths) return undefined;

        const insertText = filePaths.length === 1
            ? filePaths[0] // Already formatted by core utility
            : `c(${filePaths.join(', ')})`; // R vector syntax - R-specific
    }
}
```

## Implementation Summary

### ✅ Status: Complete & Tested

**Key Features Delivered:**
- **RStudio compatibility**: Exact `formatDesktopPath()` behavior match
- **UNC path safety**: Uses VS Code's `isUNC()` for robust network path detection
- **Cross-context support**: Single implementation works in both R files and R console
- **Language-agnostic core**: Ready for future Python/Julia extensions
- **User controllable**: `positron.r.autoConvertFilePaths` setting (defaults enabled)

**Testing Validation:**
- ✅ **Unit tests**: 12 comprehensive test cases covering all scenarios
- ✅ **Manual testing**: Confirmed working in R files and R console
- ✅ **Build verification**: Clean TypeScript compilation
- ✅ **UNC safety**: Network paths properly detected and skipped

## Files Changed

### Core Implementation
**`src/vs/workbench/contrib/positronPathUtils/common/filePathConverter.ts`** (new, 69 lines)
- Language-agnostic clipboard file detection and path formatting
- Uses VS Code utilities: `URI.parse().fsPath`, `toSlashes()`, `isUNC()`
- Universal quote escaping for any programming language

### API Surface
**`src/positron-dts/positron.d.ts`** (+24 lines)
- Official Positron extension API: `positron.paths.extractClipboardFilePaths()`

**`src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts`** (+36 lines)
- API implementation bridging VS Code and browser DataTransfer formats

### R Language Support
**`extensions/positron-r/src/languageFeatures/rFilePasteProvider.ts`** (new, 69 lines)
- VS Code `DocumentPasteEditProvider` implementation
- R-specific multi-file vector syntax: `c("file1", "file2")`

**`extensions/positron-r/src/extension.ts`** (+4 lines)
- Clean registration following existing R extension patterns

### Configuration
**`src/vs/workbench/contrib/positronPathUtils/common/pathConversion.contribution.ts`** (new, 31 lines)
- User setting: `positron.r.autoConvertFilePaths` (boolean, default: true)

### Supporting Files
**`src/vs/workbench/workbench.common.main.ts`** (+1 line) - Configuration registration
**Test file** (+199 lines) - Comprehensive unit test suite

## Technical Design Principles

1. **Leverage VS Code utilities** instead of custom implementations
2. **Language-agnostic core** with language-specific formatting layers
3. **Conservative UNC handling** - skip conversion entirely for safety
4. **Single provider pattern** - DocumentPasteEditProvider works in both contexts
5. **Official API surface** - clean `positron.paths` namespace for extensions

## Usage Examples

**Single file**: Copy from Windows Explorer → Paste in R → `"C:/Users/data.csv"`
**Multiple files**: Copy multiple files → Paste in R → `c("C:/file1.csv", "C:/file2.csv")`
**UNC paths**: Network paths remain unchanged (no conversion applied)
**Non-R contexts**: Python console unaffected