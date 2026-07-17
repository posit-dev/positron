/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Public host-side surface of the shared DuckDB Data Explorer backend. Consuming data driver
// extensions import these from 'positron-data-explorer-duckdb'; the out-of-process worker is a
// separate side-effecting entry point exposed as 'positron-data-explorer-duckdb/worker' (bundled by
// the consumer's esbuild into its own dist so the runtime __dirname lookup resolves).

export { DuckDBTableView, DuckDBSchemaEntry, IDuckDBTableCodeGenerator, duckdbDisplayType, makeWhereExpr } from './duckdbTableView.js';
export { DuckDBDataExplorerRpcHandler, IDuckDBDataExplorerHost, OpenTableViewOptions, buildDuckDBSchema } from './duckdbDataExplorerRpcHandler.js';
export { DuckDBWorkerClient, IDuckDBQueryClient, DuckDBRow } from './duckdbWorkerClient.js';
export { DuckDBWorkerPool, duckDBWorkerPool, IDuckDBWorkerLease } from './duckdbWorkerPool.js';
export { WorkerOpenConfig } from './duckdbWorkerProtocol.js';
