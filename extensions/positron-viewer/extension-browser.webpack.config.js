/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const withBrowserDefaults = require('../shared.webpack.config').browser;

module.exports = withBrowserDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts'
	}
});
