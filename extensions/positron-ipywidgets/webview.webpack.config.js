/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withBrowserDefaults = require('../shared.webpack.config').browser;

const webviewConfig = withBrowserDefaults({
	context: __dirname,
	entry: {
		webview: './webview/src/index.ts',
	},
	// externals: {
	// 	'vscode': { commonjs: 'vscode' },
	// 	'express': { commonjs: 'express' }
	// }
}, {
	configFile: './webview/tsconfig.json',
});

webviewConfig.module.rules.push({
	test: /\.css$/,
	use: ['style-loader', 'css-loader'],
}, {
	// test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
	test: /\.svg$/,
	type: 'asset/inline'
});

module.exports = webviewConfig;
