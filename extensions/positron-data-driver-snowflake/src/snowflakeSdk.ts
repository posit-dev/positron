/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Thin re-export of snowflake-sdk. The packaging build bundles this module as
// its own esbuild entry point (dist/snowflakeSdk.js), so the SDK's code is
// parsed only when the first connection loads it, not when the extension
// activates. snowflakeClient.ts imports this file rather than 'snowflake-sdk'
// so the packaged extension resolves the bundled copy instead of the package
// from node_modules, which does not ship.
import snowflake = require('snowflake-sdk');

export = snowflake;
