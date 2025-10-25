# (Mostly Windows) File Path Auto-Conversion Feature

## Overview

The intent of this feature is to replicate this RStudio behaviour: when pasting files (copied from the file manager, most especially Windows Explorer), they get converted into usable file paths. Where "usable" means `\` has been replaced by `/` and the whole path is wrapped in double quotes. (And I really do mean there are files on the clipboard, not just text that looks like a file path.)

Ideally, we would do this in R files AND in the R console (and potentially also in Python?). It turns out it's much easier to implement this in the editor, so that's where we're starting. These notes record some successful efforts to get this working in the console, but the implementation seemed yucky, so I've chosen to pause and get some advice before trying that again.

**Motivating GitHub Issue**: https://github.com/posit-dev/positron/issues/8393

These notes are partially authored by Claude and partially by @jennybc.

## Problem Statement

RStudio users expect Windows file paths to be automatically converted when pasting **files** (not text paths) into R contexts. This feature bridges the gap between file manager operations and data analysis workflows.

## Behavior

### What Gets Converted ✅
**File clipboard content** (copied from file manager):
- **Single file**: `"C:/Users/file.txt"`
- **Multiple files**: `c("C:/Users/file1.txt", "C:/Users/file2.txt")`
- **Files with spaces**: `"C:/Users/My Documents/file.txt"`
- **Files with quotes**: `"C:/Users/My \"Special\" File.txt"` (properly escaped). Note that double quotes aren't allowed in Windows file paths, so until I get back onto a macOS machine, I can't be sure that we even need to worry about this case.

### What Doesn't Get Converted ❌
- **UNC paths**: `\\server\share\file.txt` (skipped entirely for safety)
- **Text paths**: `C:\Users\file.txt` typed as text (not file clipboard)
- **Mixed scenarios**: If any UNC paths detected, skip conversion for all files
- **Non-R contexts**: Python console, other languages (unaffected)

### Key Features
- **RStudio compatible**: Goal is to (eventually) match `formatDesktopPath()` behavior exactly
- **Safe UNC handling**: Uses VS Code's `isUNC()` to detect and skip network paths
- **User controllable**: `positron.r.autoConvertFilePaths` setting (defaults enabled)
- **Platform agnostic**: Works on any OS, detects file clipboard via `text/uri-list`
- **Universal string formatting**: Quote escaping works for any programming language

## Architecture

**3-Layer Design** maintaining clean separation of concerns:

### 1. Core Layer (Language-Agnostic)
**File**: `src/vs/workbench/contrib/positronPathUtils/common/filePathConverter.ts`

Key exported function is `convertClipboardFiles()`.

Unit tests in `src/vs/workbench/contrib/positronPathUtils/test/browser/filePathConverter.test.ts`

### 2. API Layer (Official Positron Extension API)
**Files**: `src/positron-dts/positron.d.ts` + `src/vs/workbench/api/common/positron/extHost.positron.api.impl.ts`

Exposes `positron.paths.extractClipboardFilePaths()` for extensions to use.

### 3. Language Layer (only in positron-r for now)
**File**: `extensions/positron-r/src/languageFeatures/rFilePasteProvider.ts`

`provideDocumentPasteEdits()` checks the user setting `positron.r.autoConvertFilePaths` and whether `positron.paths.extractClipboardFilePaths()` has any paths to provide.

If not, early return of `undefined` and default paste behaviour takes over.

If so, the converted file paths are potentially formatted for use in R, e.g. inside `c(...)` for multiple files.

`registerRFilePasteProvider()` is used in `extensions/positron-r/src/extension.ts` to register the provider via `vscode.languages.registerDocumentPasteEditProvider()`. This is the missing piece for the console. What's the best equivalent implementation there?

## Implementation Summary

### ✅ Status: R Files Complete & Tested | Console Deferred

**Key Features Delivered:**
- **RStudio compatibility**: Exact `formatDesktopPath()` behavior match
- **UNC path safety**: Uses VS Code's `isUNC()` for robust network path detection
- **R files support**: Full implementation working in R source files
- **Language-agnostic core**: Ready for future Python/Julia extensions
- **User controllable**: `positron.r.autoConvertFilePaths` setting (defaults enabled)

**Testing Validation:**
- ✅ **Unit tests**: comprehensive test cases covering all scenarios
- ✅ **Manual testing**: Confirmed working in R files - produces `"c:/Users/jenny/readxl/inst/extdata/datasets.xlsx"`
- ✅ **Build verification**: Clean TypeScript compilation
- ✅ **UNC safety**: Network paths properly detected and skipped

### 📋 Console Status: Attempted, Learned From, Removed

**What We Learned About Console Architecture:**
- **Console is not a document**: Uses "simple widget"/mini editor architecture, so `DocumentPasteEditProvider` doesn't work
- **Different paste handling**: Console has its own paste logic in `positronConsole.contribution.ts` that only calls `clipboardService.readText()`
- **Architecture challenges**: We (Claude and @jennybc) did get this working, but it didn't feel well-designed. In particular, R-specific stuff was appearing Positron core. How to make this behaviour something that a language pack can contribute?

**Decision**: Console implementation was **attempted, learned from, and removed**. Shipping with R files support only.

**Future Console Work:**
For future console implementation, investigate:
1. **Root cause**: Why enhanced console paste handler didn't trigger
2. **Alternative approaches**: Direct Monaco editor integration, different paste event handling

## Testing/Debugging

**To see the paste provider title**: Copy files from file manager, then use **"Paste As"** from the Command Palette (Ctrl+Shift+P) in an R file. This shows the picker with "Insert quoted, forward-slash file path(s)" option. NOTE: this is no longer working, once we pared things way back. Hopefully we can get it back for the console implementation.

**To run a small set of unit tests**: Do something like ...

* `scripts/test.sh --grep "UNC path"`
* `scripts/test.sh --grep "File Path Converter Tests"`

**To manually test UNC paths**:

* Open Windows Explorer
* Type `\\localhost\c$` and press Enter
* Navigate to any file and copy it
* Paste into an R file in Positron and (hopefully) observe no conversion

Example: `\\localhost\c$\Users\jenny\readxl\inst\extdata\geometry.xlsx`

## Interesting code to study

The markdown-language-features extension has a similar feature for pasting or dragging-and-dropping of files into markdown documents. I will look at this later. Key files:

* `extensions\markdown-language-features\src\languageFeatures\copyFiles\dropOrPasteResource.ts`
* `extensions\markdown-language-features\src\extension.shared.ts`
* `extensions\markdown-language-features\src\languageFeatures\copyFiles\shared.ts` (look at `getRelativeMdPath()`)

Other potentially interesting files:
* `src\vs\editor\contrib\dropOrPasteInto\browser\defaultProviders.ts`

## RStudio's implementation

* `onDesktopPaste()`: <https://github.com/rstudio/rstudio/blob/5364b4eb3fd7333c15b5e637007bf93d48963c50/src/gwt/src/org/rstudio/studio/client/workbench/views/source/editors/text/AceEditorWidget.java#L428-L490>
* `makeProjectRelative()`: <https://github.com/rstudio/rstudio/blob/4f7258ad7728bca57e8635c9011f351801620e22/src/cpp/session/modules/SessionFiles.cpp#L781-L815>
* `FilePath::createAliasedPath()`: <https://github.com/rstudio/rstudio/blob/5364b4eb3fd7333c15b5e637007bf93d48963c50/src/cpp/shared_core/FilePath.cpp#L444-L472>

## Possible Next Steps

### Quarto Document Support via Extension Collaboration

**Problem**: R file paste provider currently doesn't work in R chunks within Quarto documents (`.qmd` files) because document paste providers are registered by document language ID (`'quarto'`), not embedded language context.

**Proposed Solution**: Use VS Code's `prepareDocumentPaste` API for inter-extension collaboration:

1. **Quarto extension registers paste provider** for `.qmd` files with `prepareDocumentPaste` implementation
2. **During copy operations**: Quarto extension detects source language context (R, Python, etc.) and attaches metadata via `DataTransfer.set('application/vnd.code.editor-context', ...)`
3. **During paste operations**: Language-specific paste providers (R, Python) check for context metadata and activate accordingly
4. **Clean separation**: Quarto handles language detection, language extensions handle language-specific formatting

**Benefits**:
- **No document parsing in language extensions**: R extension doesn't need to understand Quarto syntax
- **Extensible pattern**: Works for Python chunks, Julia chunks, etc.
- **Uses intended VS Code APIs**: `prepareDocumentPaste` is designed exactly for this metadata attachment scenario
- **Performance**: Language context computed once during copy, not during every paste
- **Standard DataTransfer**: Uses VS Code's standard mechanism, no custom protocols needed

**Implementation approach**:
- Quarto extension: `prepareDocumentPaste` detects language at cursor, attaches `{ language: 'r', sourceType: 'quarto-chunk' }` metadata
- R extension: Check for metadata in `provideDocumentPasteEdits`, activate if present
- Custom MIME type: Use `application/vnd.code.editor-context` to avoid conflicts
