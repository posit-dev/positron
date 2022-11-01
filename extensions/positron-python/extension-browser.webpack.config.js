/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./build/webpack/webpack.extension.browser.config');
const withBrowserDefaults = require('../shared.webpack.config').browser;

module.exports = withBrowserDefaults({
    context: __dirname,
    ...config
});

