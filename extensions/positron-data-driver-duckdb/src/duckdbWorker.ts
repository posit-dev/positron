/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Entry point for the forked DuckDB child process. The actual worker lives in the shared
// positron-data-explorer-duckdb package; this thin re-export is the esbuild entry point so the
// worker is bundled into this extension's own dist/ (next to extension.js) and located at runtime
// via __dirname by the shared DuckDBWorkerClient. Importing the module runs it (it reads its config
// from process.argv and installs the IPC message handler).
import 'positron-data-explorer-duckdb/worker';
