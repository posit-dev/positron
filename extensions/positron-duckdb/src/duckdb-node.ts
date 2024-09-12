/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolve, dirname } from 'path';

export function getDuckDBNodeBundles() {
	const modPath = require.resolve('@duckdb/duckdb-wasm');
	const dist_path = dirname(modPath);
	return {
		mvp: {
			mainModule: resolve(dist_path, './duckdb-mvp.wasm'),
			mainWorker: resolve(dist_path, './duckdb-node-mvp.worker.cjs')
		},
		eh: {
			mainModule: resolve(dist_path, './duckdb-eh.wasm'),
			mainWorker: resolve(dist_path, './duckdb-node-eh.worker.cjs')
		}
	};
}
