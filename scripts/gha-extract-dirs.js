/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const { dirs } = require('../build/npm/dirs.js'); // replace with the correct path to your file

// Output directories joined by commas
const paths = dirs.map(dir => dir ? `${dir}/node_modules` : 'node_modules');
console.log(paths.join(','));
