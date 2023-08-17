/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withNodeDefaults = require('../shared.webpack.config');
const path = require('path');

module.exports = withNodeDefaults({
	context: __dirname,
	resolve: {
		mainFields: ['module', 'main']
	},
	ignoreWarnings: [/Critical dependency: the request of a dependency is an expression/],
	entry: {
		extension: './src/extension.ts',
	}
});
