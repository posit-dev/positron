# Catalog Explorer

Explore tables, views, and files backed by data catalogs.

## Overview

Catalog Explorer is a VSIX extension that provides a convenient interface for browsing and accessing data in various catalog systems. It includes features for:

- Browsing catalogs, schemas, tables, and files in a tree view
- Copying paths to data objects
- Generating code snippets for Python and R to access data
- Opening data objects in Positron sessions

The extension makes it easy to explore and work with data stored in data catalogs directly from your Positron environment.

## Development

To enable the Mock Catalog Explorer for development and testing, set the following in your `settings.json`:

```json
"positronCatalogExplorer.viewTestCatalog": true
```
