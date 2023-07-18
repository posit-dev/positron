/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');

const version = process.versions.node;
const currentVersionString = `Node version: ${version}`;
const major = parseInt(version.split('.')[0]);
const minor = parseInt(version.split('.')[1]);

const recommendedVersion = fs.readFileSync('.nvmrc').toString().trim();
const recommendedMajor = parseInt(recommendedVersion.split('.')[0]);
const recommendedMinor = parseInt(recommendedVersion.split('.')[1]);


if (major === recommendedMajor && minor === recommendedMinor) {
	console.log(currentVersionString);
} else if (major === recommendedMajor) {
	console.log(`${currentVersionString} (${recommendedVersion} is recommended)`);
} else { // mismatched major version of node, print a warning to the terminal in red
	console.warn(`\x1b[31m${currentVersionString} may not be supported\x1b[0m`);
	console.warn(`\x1b[31mConsider using node version ${recommendedVersion}\x1b[0m`);
}
