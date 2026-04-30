/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const path = require('path');

// Load the webpack config for the Python extension
const config = require('./build/webpack/webpack.extension.config');

// Merge them with settings for this environment
module.exports.default = {
	...config.default,
	entry: {
		extension: './src/client/extension.ts',
	},
	externals: [
		'vscode',
		'positron',
		'commonjs',
		'applicationinsights-native-metrics',
		'@opentelemetry/tracing',
		'@opentelemetry/instrumentation',
		'@azure/opentelemetry-instrumentation-azure-sdk',
		'@azure/functions-core'
	],
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'dist', 'client'),
		// libraryTarget 'commonjs2' emits `module.exports = ...` at the end of the bundle,
		// which is required because vscode-tas-client uses a UMD wrapper that does
		// `module.exports = factory()` during bundle load, replacing the outer module.exports.
		// With 'commonjs' (which only assigns to `exports`), vscode-tas-client's replacement
		// persists and the extension's activate/deactivate are lost.
		libraryTarget: 'commonjs2',
	},
	context: __dirname
};

