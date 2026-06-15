# Positron DuckDB Extension Development Context

This prompt provides context for working with the `positron-duckdb` extension, which provides native DuckDB support for headless data exploration in Positron.

**Related documentation:**
- **Build system**: `.claude/build-system.md` - For daemon management and compilation
- **Data Explorer UI**: `.claude/data-explorer.md` - For frontend components that use this extension
- **Testing**: `.claude/e2e-testing.md` - For E2E tests involving data exploration

## Extension Overview

**Purpose**: Provides DuckDB support for headless data explorers for previewing data files  
**Display Name**: "Positron DuckDB Support"  
**Location**: `extensions/positron-duckdb/`  
**Main Entry**: `src/extension.ts`  
**Dependencies**: `@duckdb/node-api` (pulls in the platform-specific `@duckdb/node-bindings-*` native binding for the host)  

The extension uses the native `@duckdb/node-api` ("node neo") package, which wraps pre-built DuckDB binaries. It reads compressed CSV/TSV files and supports multithreading.

## Architecture

### Core Components

1. **DuckDBInstance**: Manages the native DuckDB database connection (`@duckdb/node-api`)
2. **QueryResult**: Thin wrapper over a node-api result reader; exposes `toArray()`, `columnAt(i)`, `columnByName(name)`, `columnNames`, `numRows`, `numCols`.
3. **DuckDBTableView**: Handles data explorer requests for a specific table
4. **ColumnProfileEvaluator**: Computes statistical summaries and profiles 
5. **DataExplorerRpcHandler**: Implements the Data Explorer RPC protocol

### Key Features

- **File Support**: CSV, TSV, Parquet (including gzip/zstd-compressed versions, read natively from disk)
- **SQL Engine**: Full DuckDB SQL capabilities via native pre-built binaries
- **Data Profiling**: Histograms, frequency tables, summary statistics
- **Filtering & Sorting**: Row filters, column filters, sorting
- **Data Export**: CSV, TSV, HTML export formats
- **Schema Search**: Column name and type filtering

## File Structure

```
extensions/positron-duckdb/
├── package.json          # Extension manifest
├── package.nls.json      # Localized strings
├── src/
│   ├── extension.ts      # Main extension logic
│   │                     # (protocol types come from the positron-data-explorer-protocol package)
│   └── test/
│       ├── extension.test.ts  # Unit tests
│       ├── README.md         # Test instructions
│       └── data/             # Test datasets
│           ├── flights.csv
│           └── flights.parquet
├── tsconfig.json         # TypeScript configuration
└── esbuild.mts           # Build configuration
```

## Quick Development Workflow

### 1. Prerequisites
Ensure build daemons are running (see `.claude/build-system.md`):
```bash
# Check daemon status first
ps aux | grep -E "npm.*watch-extensionsd" | grep -v grep

# Start if not running
npm run watch-extensionsd &
sleep 30  # Wait for compilation
```

### 2. Testing
```bash
# Run all DuckDB extension tests
npm run test-extension -- -l positron-duckdb

# Test specific functionality
npm run test-extension -- -l positron-duckdb --grep "histogram"
npm run test-extension -- -l positron-duckdb --grep "csv"
npm run test-extension -- -l positron-duckdb --grep "filter"
```

### 3. Development Cycle
1. Edit code in `extensions/positron-duckdb/src/`
2. Watch for compilation completion in daemon output
3. Run tests to verify changes
4. Debug using test data in `extensions/positron-duckdb/src/test/data/`

## Key Classes and Interfaces

### DuckDBInstance
Manages the native DuckDB runtime via `@duckdb/node-api`:
- Creates an in-memory `DuckDBInstance` and a connection
- Serializes and executes SQL queries (returns a `QueryResult`)
- Provides error handling and logging

### DuckDBTableView
Implements data explorer backend protocol:
- Handles schema operations
- Executes data value queries
- Manages filtering and sorting
- Computes column profiles
- Exports data selections

### ColumnProfileEvaluator  
Statistical computation engine:
- Generates SQL for statistical queries
- Computes histograms using multiple methods (Fixed, Freedman-Diaconis, Sturges)
- Creates frequency tables for categorical data
- Calculates summary statistics (min/max/mean/median/stdev)

### Data Explorer RPC Protocol
The extension implements the full Data Explorer RPC protocol:
- `OpenDataset`: Import files or connect to tables
- `GetSchema`: Retrieve column information
- `GetDataValues`: Query formatted cell values
- `SetRowFilters`: Apply WHERE clause filters
- `SetSortColumns`: Apply ORDER BY sorting
- `GetColumnProfiles`: Generate statistical summaries
- `ExportDataSelection`: Export data in various formats

**IMPORTANT: Protocol Types Location**
The Data Explorer protocol types are auto-generated from `positron/comms/data_explorer-backend-openrpc.json` by `positron/comms/generate-comms.ts` into two TypeScript outputs: the core comm (`src/vs/workbench/services/languageRuntime/common/positronDataExplorerComm.ts`) and the shared, extension-facing module (`extensions/positron-data-explorer-protocol/src/dataExplorerProtocol.ts`). This extension imports the protocol types from the `positron-data-explorer-protocol` package (a `file:` dependency); it no longer vendors its own `interfaces.ts`. **Do NOT manually edit either generated file** - change the OpenRPC schema and re-run the generator (`cd positron/comms && npx tsx generate-comms.ts data_explorer`).

DuckDB-specific extensions to the protocol (like `SetDatasetImportOptions` for CSV import options) live in the OpenRPC schema and flow through the generator to both outputs above.

## Supported Data Types

### DuckDB to Display Type Mapping
- **BOOLEAN** → Boolean
- **INTEGER, BIGINT, FLOAT, DOUBLE** → Number
- **VARCHAR, UUID** → String  
- **DATE** → Date
- **TIMESTAMP** → Datetime
- **TIME** → Time
- **INTERVAL** → Interval
- **DECIMAL** → Number (with special handling)

### Special Value Handling
- `NULL` values: Proper null handling across all types
- `NaN`, `Inf`, `-Inf`: Special numeric value formatting
- Empty strings: Distinguished from null for string types
- Large numbers: Scientific notation for values > 10^N

## Testing Patterns

### Test Structure
```typescript
import { DataExplorerRpc, DataExplorerBackendRequest } from '../interfaces';

// Helper functions
async function dxExec(rpc: DataExplorerRpc): Promise<any> { }
async function runQuery<Type>(query: string): Promise<Array<Type>> { }
function makeTempTableName(): string { }

// Test patterns
suite('DuckDB Extension Tests', () => {
    test('should handle CSV files', async () => {
        // Test CSV import and querying
    });
    
    test('should compute histograms', async () => {
        // Test statistical profiling
    });
    
    test('should filter data correctly', async () => {
        // Test row filtering
    });
});
```

### Test Data
- `flights.csv`: Sample airline data for testing
- `flights.parquet`: Same data in Parquet format
- Various edge cases: nulls, special values, large datasets

## Common Development Tasks

### Adding New File Format Support
1. Update `createTableFromUri()` method
2. Add file extension detection logic  
3. Implement appropriate DuckDB import function
4. Add tests with sample data

### Adding New Filter Types
1. Add filter type to `RowFilterType` enum
2. Implement logic in `makeWhereExpr()` function
3. Add SQL generation for new filter
4. Update supported features list
5. Add comprehensive tests

### Adding New Statistical Profiles
1. Add profile type to `ColumnProfileType` enum
2. Implement computation in `ColumnProfileEvaluator`
3. Add SQL generation for new statistic
4. Update result interfaces
5. Test with various data types

### Debugging Tips

#### Enable Debug Logging
Set `DEBUG_LOG = true` in extension.ts for query logging

#### Common Issues
1. **Native Binding Loading**: `@duckdb/node-api` loads the platform-specific `@duckdb/node-bindings-*` package, installed automatically as a transitive optional dependency for the build host's architecture. Positron ships arch-specific packages, so each build carries only its matching binding.
2. **File Reading**: Files are read directly from disk by path (`uri.fsPath`); native DuckDB transparently decompresses `.gz`/`.zst` CSV/TSV. Non-`file:` URIs (and compressed Parquet, which DuckDB's reader can't unwrap, decompressed in JS via `decompress()`) are spilled to a temp file first.
3. **SQL Generation**: Ensure proper identifier quoting with `quoteIdentifier()` and string-literal escaping (file paths) with `quoteLiteral()`
4. **Memory Management**: Clean up resources and event handlers
5. **Type Conversions**: node-api returns `BigInt` for integer types and `DuckDBValue` wrappers for temporal/decimal types; most queries `CAST(... AS VARCHAR)` so values arrive as strings. Wrap counts in `Number(...)`.

#### Testing Isolation  
- Use `makeTempTableName()` for unique table names
- Clean up temporary tables after tests
- Test with various data sizes and edge cases

## Integration Points

### VSCode Extension API
- Command registration: `positron-duckdb.runQuery`
- Data Explorer backend registration via `positron.dataExplorer.registerRpcHandler('positron-duckdb', ...)` (typed ext-host channel); async UI events are pushed back through the returned session's `sendUiEvent`
- File system watching for data file changes
- URI handling for different data sources

### Positron Data Explorer
- Implements backend protocol for data exploration UI
- Provides statistical profiling for data science workflows  
- Integrates with Variables pane for dataframe viewing

### Native DuckDB (`@duckdb/node-api`)
- Leverages DuckDB's SQL engine via pre-built native binaries
- Reads files (including compressed/remote) directly
- Handles large datasets with pagination (LIMIT/OFFSET)

## Performance Considerations

- **Query Optimization**: Use subqueries for better DuckDB performance
- **Batch Statistics**: Compute multiple statistics in single query
- **Pagination**: Implement LIMIT/OFFSET for large result sets
- **Type Conversion**: Prefer formatting values to strings in SQL over per-value JS conversion
