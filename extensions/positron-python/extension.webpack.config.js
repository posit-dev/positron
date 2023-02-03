/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const path = require('path');

// Load the shared webpack config for all built-in extensions
const withDefaults = require('../shared.webpack.config');

// Load the webpack config for the Python extension
const config = require('./build/webpack/webpack.extension.config');

// Merge them with settings for this environment
module.exports = withDefaults({
    ...config.default,
    entry: {
        extension: './src/client/extension.ts',
    },
    externals: [
        'vscode',
        'positron',
        'commonjs',
        'applicationinsights-native-metrics',
        '@opentelemetry/tracing',
        '@opentelemetry/instrumentation'
    ],
    output: {
        filename: '[name].js',
        path: path.join(__dirname, 'dist', 'client'),
        libraryTarget: 'commonjs',
    },
    context: __dirname
});

