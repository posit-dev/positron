/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withBrowserDefaults = require('../../shared.webpack.config').browser;
const path = require('path');

module.exports = withBrowserDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/index.tsx',
	},
	node: {
		__dirname: false
	},
	resolve: {
		mainFields: ['module', 'main'],
		extensions: ['.ts', '.tsx']
	}
});

