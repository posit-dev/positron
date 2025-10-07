# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Catalog Explorer is a VS Code extension (published as "Catalog Explorer" by Posit) that allows users to explore tables, views, and files backed by data catalogs. It primarily focuses on connecting to Databricks Unity Catalog but appears to be designed to support other catalog providers in the future.

The extension integrates with VS Code to provide:

- A tree view in the Explorer panel for browsing catalog providers, schemas, tables, and files
- Commands for copying table paths and generating code snippets for Python and R
- Integration with the Positron IDE for opening catalog items in sessions

## Development Workflow

### Building and Running

1. **Setup development environment**:

      ```bash
      npm install
      ```

2. **Build the extension**:

      ```bash
      # Development build with source maps
      npm run compile

      # Production build (minified)
      npm run package
      ```

3. **Watch mode** (for development with auto-rebuild):

      ```bash
      npm run watch
      ```

4. **Testing**:

      ```bash
      npm run test
      ```

5. **Linting**:

      ```bash
      npm run lint
      ```

6. **Creating a VSIX package** (for distribution or testing):

      ```bash
      npm run vsix
      ```

## Architecture

### Core Components

1. **Catalog System**:

      - `CatalogProvider`: Interface for backends that provide hierarchical catalogs
      - `CatalogNode`: Represents items in the catalog tree (tables, schemas, files, etc.)
      - `CatalogTreeDataProvider`: Implements VS Code's tree data provider for displaying catalogs
      - `CatalogProviderRegistry`: Registry for available catalog providers

2. **Catalog Providers**:

      - `DatabricksCatalogProvider`: Implementation for Databricks Unity Catalog
      - `MockProvider`: Demo provider for testing during development

3. **File System Integration**:

      - `DbfsProvider`: File system provider for Databricks File System (DBFS)
      - `DatabricksFilesClient`: Client for interacting with Databricks files

4. **Credential Management**:

      - `DefaultDatabricksCredentialProvider`: Manages credentials for Databricks

5. **Code Generation**:
      - Helper functions for generating Python and R code snippets for tables and files

### Extension Activation Flow

1. The extension is activated when a user accesses a DBFS file system or when the catalog explorer view is accessed
2. The extension registers catalog providers (Databricks and a mock provider in dev mode)
3. It sets up commands for interacting with the catalog explorer
4. It registers the tree view provider to display the catalog hierarchy

### User Interaction Flow

1. Users add a catalog provider (e.g., Databricks Unity Catalog)
2. The extension authenticates with the provider using user credentials
3. The catalog structure is displayed in the Explorer panel
4. Users can browse catalogs, schemas, tables, and files
5. For tables and files, users can copy paths or code snippets to use in Python or R

## Key Files

- `src/extension.ts`: Main entry point for the extension
- `src/catalog.ts`: Core interfaces and classes for catalog system
- `src/catalogs/databricks.ts`: Implementation of Databricks catalog provider
- `src/fs/dbfs.ts`: Implementation of DBFS file system provider
- `src/credentials.ts`: Credential management for catalog providers
- `src/positron.ts`: Integration with Posit's VSCode extension (Positron)
