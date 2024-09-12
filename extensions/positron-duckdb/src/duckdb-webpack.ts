/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import duckdb_wasm_mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm';
import duckdb_worker_mvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm';
import duckdb_worker_eh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js';

export function getDuckDBWebpackBundles() {
	return {
		mvp: {
			mainModule: duckdb_wasm_mvp,
			mainWorker: duckdb_worker_mvp,
		},
		eh: {
			mainModule: duckdb_wasm_eh,
			mainWorker: duckdb_worker_eh,
		},
	};
}
