/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../../shared.webpack.config');
const path = require('path');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/main.ts',
	},
	node: {
		__dirname: false
	},
	output: {
		filename: 'main.js',
		path: path.join(__dirname, 'dist', 'ui'),
	}
});
