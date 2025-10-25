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
      npm run compile
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

## Architecture

### Core Components

1. **Catalog System**:

      - `CatalogProvider`: Interface for backends that provide hierarchical catalogs
      - `CatalogNode`: Represents items in the catalog tree (tables, schemas, files, etc.)
      - `CatalogTreeDataProvider`: Implements VS Code's tree data provider for displaying catalogs
      - `CatalogProviderRegistry`: Registry for available catalog providers

2. **Catalog Providers**:

      - `DatabricksCatalogProvider`: Implementation for Databricks Unity Catalog
      - `SnowflakeCatalogProvider`: Implementation for Snowflake catalogs, utilizing the Snowflake connector node-js driver. Docs are available at https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate to set up authentication and https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-execute to execute queries.
      - `MockProvider`: Demo provider for testing during development

3. **File System Integration**:

      - `DbfsProvider`: File system provider for Databricks File System (DBFS)
      - `DatabricksFilesClient`: Client for interacting with Databricks files

4. **Credential Management**:

      - `DefaultDatabricksCredentialProvider`: Manages credentials for Databricks

5. **Code Generation**:
      - Helper functions for generating Python and R code snippets for tables and files

### Extension Activation Flow

1. The extension is activated on Positron startup, if the "catalogExplorer.enabled" setting is true
2. The extension registers catalog providers (a mock provider is available if "catalogExplorer.viewTestCatalog" is set)
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
- `src/catalogs/unityCatalogClient.ts`: Client for Databricks Unity Catalog API
- `src/fs/dbfs.ts`: Implementation of DBFS file system provider
- `src/credentials.ts`: Credential management for catalog providers

## Testing Structure

The extension's test suite is organized to verify both API client functionality and VS Code integration:

### Test Files

- `src/test/databricksCatalogTreeView.test.ts`: Tests for the VS Code tree view integration with Databricks Unity Catalog
- `src/test/unityCatalogClient.test.ts`: Tests for the raw Unity Catalog API client functionality
- `src/test/dbfs.test.ts`: Tests for the Databricks File System provider
- `src/test/databricksCatalog.test.ts`: Tests for the Databricks catalog provider integration

### Mock System

- `src/test/mocks/unityCatalogMock.ts`: Contains mock data and stubs for the Unity Catalog API
  - Provides mock catalog, schema, table, and volume data
  - Implements Sinon stubs to intercept API calls with `setupStubs()`
  - Supports testing API URL construction and response handling

### Key Test Concepts

1. **API Verification**: Tests verify that the correct API endpoints are called with appropriate parameters:
   - Catalog listing (`/api/2.1/unity-catalog/catalogs`)
   - Schema listing (`/api/2.1/unity-catalog/schemas?catalog_name=...`)
   - Table listing (`/api/2.1/unity-catalog/tables?catalog_name=...&schema_name=...`)
   - Volume listing (`/api/2.1/unity-catalog/volumes?catalog_name=...&schema_name=...`)

2. **Navigation Testing**: Tests verify proper navigation through catalog hierarchies:
   - Catalogs → Schemas → Tables/Volumes

3. **Error Handling**: Tests verify graceful handling of API errors and edge cases:
   - Authentication errors
   - Empty response handling
   - Error response handling

### Running Tests

Tests can be run using the VS Code testing framework:

```bash
npm test
```

The test system uses:
- Mocha as the test framework
- Sinon for mocking and stubbing
- Node's built-in assertions
