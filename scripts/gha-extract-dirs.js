/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const { dirs } = require('../build/npm/dirs.js'); // replace with the correct path to your file

// Output each directory's node_modules path
dirs.forEach(dir => {
	// Ensure that empty strings represent the root directory
	const path = dir ? `${dir}/node_modules` : 'node_modules';
	console.log(path);
});
