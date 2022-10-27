/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./build/webpack/webpack.extension.browser.config');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
    context: __dirname,
    ...config
});

