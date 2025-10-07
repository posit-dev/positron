# Catalog Explorer

Explore tables, views, and files backed by data catalogs.

## Overview

Catalog Explorer is a VSIX extension that provides a convenient interface for browsing and accessing data in various catalog systems. It includes features for:

- Browsing catalogs, schemas, tables, and files in a tree view
- Copying paths to data objects
- Generating code snippets for Python and R to access data
- Opening data objects in Positron sessions

The extension makes it easy to explore and work with data stored in data catalogs directly from your VS Code or Positron environment.

## Development

### Setup

1. Clone the repository
2. Install dependencies:
      ```bash
      npm install
      ```

### Build

- Development build with source maps:

     ```bash
     npm run compile
     ```

- Production build (minified):

     ```bash
     npm run package
     ```

- Watch mode (for development with auto-rebuild):
     ```bash
     npm run watch
     ```

### Package

- Create a VSIX package for distribution or testing:

     ```bash
     npm run vsix
     ```

- Create a pre-release VSIX package:
     ```bash
     npm run prerelease
     ```
