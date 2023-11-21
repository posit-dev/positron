/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const { defineConfig } = require('@vscode/test-cli');

// TODO: Set mocha UI, colors, timeout?
module.exports = defineConfig({
	files: 'out/test/**/*.test.js',
});
