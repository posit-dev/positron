/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config.mjs').default;

module.exports.default = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
	},
	node: {
		__dirname: false
	},
	externals: {
		// WASM package must be external - cannot be bundled
		'wasm-qmd-parser': 'commonjs wasm-qmd-parser'
	},
	resolve: {
		extensions: ['.ts', '.js', '.wasm']
	}
});
