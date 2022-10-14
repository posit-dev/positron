#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

// This script displays the current version of Positron, as specified in the product.json file
// and the anchor commit hash.

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

// Read the product details from the product.json file in the directory above
// this script
const productJson = fs.readFileSync(path.resolve(__dirname, '../product.json'), 'utf8');
const product = JSON.parse(productJson);

// Read the Positron version
const version = product.positronVersion;

// Check to see whether there's already a file with this version's name
const anchorPath = path.resolve(__dirname, version + '.commit');
if (!fs.existsSync(anchorPath)) {
	console.log(`Anchor file ${anchorPath} does not exist for version ${version}.`);
	return 1;
}

// Read the commit from the anchor file
const commit = fs.readFileSync(anchorPath, 'utf8').trim();

// Compute the distance from the anchor commit to the current commit
const distance = child_process.execSync(`git rev-list --count ${commit}..HEAD`).toString().trim();

console.log(`${version}-${distance}`);

