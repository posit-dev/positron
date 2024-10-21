/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const { IgnorePlugin } = require('webpack');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
	},
	node: {
		__dirname: false
	},
	externals: {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'@duckdb/duckdb-wasm': 'commonjs @duckdb/duckdb-wasm',
		'web-worker': 'commonjs web-worker',
	}
});
