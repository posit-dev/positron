/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');
const withDefaults = require('../shared.webpack.config');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const PermissionsOutputPlugin = require('webpack-permissions-plugin');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
	},
	plugins: [
		...withDefaults.nodePlugins(__dirname),

		// CopyWebpackPlugin loses the executable bit, so we need to set it back using
		// webpack-permissions-plugin.
		//
		// See: https://github.com/webpack-contrib/copy-webpack-plugin/issues/35
		new PermissionsOutputPlugin({
			buildFolders: [
				path.resolve(__dirname, 'dist', 'bin')
			]
		}),

		// Copy the ark executable to the output folder so it will get included in the packaging
		// step.
		new CopyWebpackPlugin({
			patterns: [
				{
					from: './amalthea/target/debug/ark',
					to: path.resolve(__dirname, 'dist', 'bin')
				},
			],
		}),
	],
});
