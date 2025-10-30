/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
	module: {
		rules: [
			{
				test: /\.node$/,
				use: [
					{
						loader: 'node-loader',
						options: {
							name: '[path][name].[ext]'
						}
					},
				],
			},
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							compilerOptions: {
								'sourceMap': true,
							},
							onlyCompileBundledFiles: true,
						},
					}
				]
			}
		]
	}
});
