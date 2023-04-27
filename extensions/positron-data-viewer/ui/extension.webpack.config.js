/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');

module.exports = {
	context: __dirname,
	target: 'web',
	entry: {
		index: './src/app.tsx'
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader'],
				exclude: /node_modules/,
			}
		],
	},
	externals: {},
	resolve: {
		extensions: ['.js', '.jsx', '.ts', '.tsx', '.css']
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'dist'),
		libraryTarget: 'umd',
	},
};

