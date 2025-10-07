# Windows File Path Auto-Conversion Implementation Plan

## Problem Statement

Users coming from RStudio expect Windows file paths to be automatically converted when pasting **files** (copied from file manager/desktop) into R contexts. Currently, copying files from Windows Explorer and pasting into Positron's R console or R editor doesn't work, but RStudio automatically converts these to properly formatted R file paths.

**GitHub Issue**: https://github.com/posit-dev/positron/issues/8393

## RStudio Analysis

After reviewing RStudio's source code (`AceEditorWidget.java`), we discovered RStudio's approach:
- **Triggers on file clipboard content** (not text paths)
- Uses `Desktop.getFrame().getPathForFile()` to detect copied files
- Applies `formatDesktopPath()`: normalizes slashes, escapes quotes, wraps in quotes
- Single file: `"C:/path/file.txt"`
- Multiple files: `c("C:/path/file1.txt", "C:/path/file2.txt")`

## Scope & Decisions

### What Gets Converted
✅ **Convert these** (files copied from file manager):
- **Single file**: Copy file from Windows Explorer → `"C:/Users/file.txt"`
- **Multiple files**: Copy multiple files → `c("C:/Users/file1.txt", "C:/Users/file2.txt")`
- **Files with spaces**: `"C:/Users/My Documents/file.txt"`
- **Files with quotes in name**: `"C:/Users/My \"Special\" File.txt"` (escaped)

❌ **Leave these alone**:
- `C:\Users\file.txt` typed or pasted as text (not file clipboard)
- `Please load C:\file.txt` (text content, not files)
- Text paths from any source (not matching RStudio behavior)

### Key Design Decisions
1. **File-based detection**: Only convert when actual files are in clipboard
2. **Exact RStudio compatibility**: Match `formatDesktopPath()` behavior exactly
3. **Always quote and escape**: `"C:/path"` format with escaped internal quotes
4. **Multiple file support**: R vector format `c("file1", "file2")`
5. **Platform agnostic**: Works on any platform, detects file clipboard content
6. **User controllable**: Single boolean setting, defaults to enabled

## Implementation Plan

### Phase 1: Foundation

#### Step 1: Create File Path Conversion Utility
**File**: `src/vs/workbench/contrib/positronPathUtils/common/filePathConverter.ts` (new)

**File Detection Logic**:
```typescript
// Detect files in clipboard (matches RStudio's approach)
export function convertClipboardFiles(dataTransfer: DataTransfer): string | null {
  // Check for file URI list (primary method)
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const fileUris = uriList.split('\n')
      .filter(line => line.startsWith('file://'))
      .map(uri => decodeURIComponent(uri.replace('file:///', '')));

    if (fileUris.length === 1) {
      return formatDesktopPath(fileUris[0]);
    } else if (fileUris.length > 1) {
      return formatMultipleFiles(fileUris);
    }
  }

  // Fallback: Check for files property
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    const filePaths = Array.from(dataTransfer.files).map(file => file.path || file.name);

    if (filePaths.length === 1) {
      return formatDesktopPath(filePaths[0]);
    } else {
      return formatMultipleFiles(filePaths);
    }
  }

  return null; // No files detected
}
```

**Conversion Logic (matches RStudio exactly)**:
```typescript
// Match RStudio's formatDesktopPath method
function formatDesktopPath(filePath: string): string {
  if (!filePath) return '';

  // Normalize slashes (\ → /)
  const normalized = filePath.replace(/\\/g, '/');

  // Escape existing quotes
  const escaped = normalized.replace(/"/g, '\\"');

  // Wrap in quotes
  return `"${escaped}"`;
}

// For multiple files, create R vector (matches RStudio)
function formatMultipleFiles(filePaths: string[]): string {
  const formattedPaths = filePaths.map(formatDesktopPath);
  return `c(${formattedPaths.join(', ')})`;
}
```

**Configuration Setting**:
```typescript
// File: src/vs/workbench/contrib/positronPathUtils/common/pathConversion.contribution.ts (new)
'positron.r.autoConvertFilePaths': {
  type: 'boolean',
  default: true,
  description: 'Automatically convert file paths when pasting files into R contexts (matches RStudio behavior)'
}
```

### Phase 2: Console Implementation (Higher Impact, Lower Risk)

#### Step 2: Modify Console Paste Handler
**File**: `src/vs/workbench/contrib/positronConsole/browser/components/consoleInput.tsx`

**Location**: Modify paste event handler around line 136 (`handlePaste` method)

**Implementation**:
```typescript
// In handlePaste method, before current logic:
private async handlePaste(e: ClipboardEvent) {
  if (e.clipboardData) {
    const isRLanguage = props.positronConsoleInstance.runtimeMetadata.languageId === 'r';
    const setting = services.configurationService.getValue('positron.r.autoConvertFilePaths');

    if (isRLanguage && setting) {
      const convertedFiles = convertClipboardFiles(e.clipboardData);
      if (convertedFiles) {
        // Insert converted file paths directly
        const codeEditorWidget = codeEditorWidgetRef.current;
        codeEditorWidget.executeEdits('console-file-paste', [
          EditOperation.replace(codeEditorWidget.getSelection(), convertedFiles)
        ]);
        e.preventDefault();
        return;
      }
    }
  }
  // Continue with existing paste logic for non-file content...
}
```

### Phase 3: Editor Implementation (Lower Impact, Higher Complexity)

#### Step 3: Create R File Paste Provider
**File**: `extensions/positron-r/src/languageFeatures/rFilePasteProvider.ts` (new)

**Implementation**:
```typescript
class RFilePasteProvider implements vscode.DocumentPasteEditProvider {
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {

    const setting = vscode.workspace.getConfiguration('positron.r').get('autoConvertFilePaths');
    if (!setting) return;

    // Check for file URIs in clipboard
    const uriListItem = dataTransfer.get('text/uri-list');
    if (!uriListItem) return;

    const uriList = await uriListItem.asString();
    const fileUris = uriList.split('\n')
      .filter(line => line.startsWith('file://'));

    if (fileUris.length === 0) return;

    const filePaths = fileUris.map(uri =>
      decodeURIComponent(uri.replace('file:///', ''))
    );

    const convertedText = filePaths.length === 1
      ? formatDesktopPath(filePaths[0])
      : formatMultipleFiles(filePaths);

    return [{
      insertText: convertedText,
      title: filePaths.length === 1
        ? 'Insert file path'
        : 'Insert file paths as R vector',
      kind: vscode.DocumentDropOrPasteEditKind.Text
    }];
  }
}
```

#### Step 4: Register Provider
**File**: `extensions/positron-r/src/extension.ts`

**Registration**:
```typescript
const pasteProvider = new RFilePasteProvider();
context.subscriptions.push(
  vscode.languages.registerDocumentPasteEditProvider(
    { language: 'r' },
    pasteProvider,
    {
      pasteMimeTypes: ['text/uri-list']
    }
  )
);
```

### Phase 4: Testing & Validation

#### Step 5: Unit Tests
**File**: `src/vs/workbench/contrib/positronPathUtils/test/filePathConverter.test.ts` (new)

**Test Cases**:
```typescript
// Single file (matches RStudio exactly)
convertClipboardFiles(createDataTransfer(['file:///C:/Users/file.txt']))
// → `"C:/Users/file.txt"`

// Multiple files (R vector format)
convertClipboardFiles(createDataTransfer([
  'file:///C:/Users/file1.txt',
  'file:///C:/Users/file2.txt'
]))
// → `c("C:/Users/file1.txt", "C:/Users/file2.txt")`

// File with spaces
convertClipboardFiles(createDataTransfer(['file:///C:/Users/My%20Documents/file.txt']))
// → `"C:/Users/My Documents/file.txt"`

// File with quotes in name (escaped)
convertClipboardFiles(createDataTransfer(['file:///C:/Users/My%20"Special"%20File.txt']))
// → `"C:/Users/My \"Special\" File.txt"`

// Windows path with backslashes (normalized)
convertClipboardFiles(createDataTransfer(['file:///C:\\Users\\file.txt']))
// → `"C:/Users/file.txt"`

// Should NOT convert (no files in clipboard)
convertClipboardFiles(createDataTransfer([], 'C:\\Users\\file.txt'))
// → null

convertClipboardFiles(createDataTransfer([], 'regular text'))
// → null
```

#### Step 6: Integration Testing
**Manual Testing Scenarios**:
- **Copy single file** from Windows Explorer → Paste into R console → should become `"C:/Users/Test/file.csv"`
- **Copy multiple files** from Windows Explorer → Paste into R console → should become `c("C:/Users/file1.csv", "C:/Users/file2.csv")`
- **Copy file** from Windows Explorer → Paste into R editor → should become `"C:/Users/Test/file.csv"`
- **Copy file** from Windows Explorer → Paste into Python console → should remain as original file operation (no conversion)
- **Type text path** `C:\Users\file.txt` → should remain unchanged (not file clipboard)
- **Test with setting disabled** → files should paste as normal file operation
- **Files with spaces and special characters** → should be properly quoted and escaped

## Implementation Order

1. **Step 1 (Utility + Configuration)** - Foundation for everything
2. **Step 2 (Console)** - Highest user impact, easier to test
3. **Test console implementation thoroughly**
4. **Steps 3-4 (Editor)** - If console works well
5. **Steps 5-6 (Testing)** - Comprehensive validation

## Risk Assessment

**Low Risk**:
- Console implementation (modifies existing, well-tested handler)
- Utility function (pure function, easy to test)

**Medium Risk**:
- Editor paste provider (new registration, needs proper lifecycle)

**Mitigation**:
- Configuration setting to disable if issues arise
- Thorough testing with real Windows file paths
- Start with console implementation for user feedback

## Success Metrics

- **Files copied from Windows Explorer automatically convert in R console**: `file:///C:/path.txt` → `"C:/path.txt"`
- **Multiple files create R vector format**: Multiple files → `c("C:/file1.txt", "C:/file2.txt")`
- **Files automatically convert in R editor files** with same formatting
- **No impact on non-R contexts** (Python console, other languages)
- **No impact on text-based paths** (typing `C:\path` remains unchanged)
- **Files with spaces and quotes properly handled** and escaped
- **Performance remains good** (file detection is fast)
- **Setting allows users to disable** feature if needed
- **Exact RStudio compatibility** - same formatting and behavior

## Files to Create/Modify

### New Files:
- `src/vs/workbench/contrib/positronPathUtils/common/filePathConverter.ts`
- `src/vs/workbench/contrib/positronPathUtils/common/pathConversion.contribution.ts`
- `src/vs/workbench/contrib/positronPathUtils/test/filePathConverter.test.ts`
- `extensions/positron-r/src/languageFeatures/rFilePasteProvider.ts`

### Modified Files:
- `src/vs/workbench/contrib/positronConsole/browser/components/consoleInput.tsx`
- `extensions/positron-r/src/extension.ts`

## Notes

- **Exact RStudio compatibility** - matches `formatDesktopPath()` and multi-file behavior
- **File-based detection** - only triggers on file clipboard content, not text paths
- **Platform agnostic** - works on any OS, detects file clipboard content
- **Conservative scope** - only acts on files copied from file manager
- **User controllable** via setting
- **Simpler implementation** than text-based approach with fewer edge cases