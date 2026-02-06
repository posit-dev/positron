# 100
# PDF Server Viewer

View PDF files using PDF.js served via a local HTTP server.

## Overview

This extension demonstrates how to serve web applications (like PDF.js) through a local Express.js HTTP server and display them in VSCode webviews using iframes.

## Architecture

- **Singleton HTTP Server**: One Express.js server shared across all open PDFs
- **Auto-assigned Port**: Uses port 0 for automatic port assignment
- **Remote Compatible**: Uses `vscode.env.asExternalUri()` for SSH, WSL, and web compatibility
- **Secure**: PDFs served with unique random IDs, no directory traversal possible

## Features

- PDF rendering with zoom controls
- Page navigation (previous/next)
- Scroll-based page tracking
- High DPI display support
- Multiple PDFs can be opened simultaneously

## Usage

1. Open any PDF file in Positron
2. Right-click in the editor
3. Select "Reopen Editor With..." → "PDF Server Preview"

## Technical Details

The extension consists of four main components:

1. **PdfHttpServer** (`pdfHttpServer.ts`): Singleton Express.js server that serves PDF.js library files and individual PDF documents
2. **PdfServerProvider** (`pdfServerProvider.ts`): Implements `vscode.CustomReadonlyEditorProvider` for PDF files
3. **PdfViewerWebview** (`pdfViewerWebview.ts`): Generates webview HTML with iframe and proper CSP configuration
4. **Extension** (`extension.ts`): Activates the extension and registers the provider

## Development

To build the extension:

```bash
npm run compile
```

To watch for changes:

```bash
npm run watch
```
