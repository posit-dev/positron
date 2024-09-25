/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
	},
	externals: {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'@vscode/windows-registry': 'commonjs @vscode/windows-registry'
	}
});
