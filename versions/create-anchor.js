#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// This script records the anchor commit for the current version of Positron, as specified
// in the product.json file.

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

// Read the product details from the product.json file in the directory above
// this script
const productJson = fs.readFileSync(path.resolve(__dirname, '../product.json'), 'utf8');
const product = JSON.parse(productJson);

// Read the Positron version
const version = product.positronVersion;

// Check to see whether there's already a file with this version's name
const anchorPath = path.resolve(__dirname, version + '.commit');
if (fs.existsSync(anchorPath)) {
	console.log(`Anchor file ${anchorPath} already exists for version ${version}.`);
	return 0;
}

const branch = child_process.execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
if (branch !== 'main') {
	console.error(`Commit anchors can only be created on the main branch. You're on '${branch}'.`);
	return 1;
}

// Create the anchor file with the commit hash at the head of the current branch
const commit = child_process.execSync('git rev-parse HEAD').toString().trim();
fs.writeFileSync(anchorPath, commit);

// Tell the user what we did
console.log(`Created anchor file ${anchorPath} for version ${version} at commit ${commit}.`);

