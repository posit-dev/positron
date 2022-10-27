/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./build/webpack/webpack.extension.config');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
    context: __dirname,
    ...config
});

