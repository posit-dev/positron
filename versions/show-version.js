#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

// This script displays the current version of Positron, as specified in the product.json file
// and the anchor commit hash.
//
// With no arguments, it displays the version and commit hash. Run with --help for more options.

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

if (process.argv.includes('--help')) {
    console.log(`Usage: ${path.basename(process.argv[1])} [options]

Options:
    --help      Show this help message
    --full      Shows the full version number, including build number and commit
    --short     Shows the short version number, such as 2022.10.0-123
    --version   Show the base version number, such as 2022.10.0
    --build     Shows just the build number`);
    process.exit(0);
}

// Read the product details from the product.json file in the directory above
// this script
const productJson = fs.readFileSync(path.resolve(__dirname, '../product.json'), 'utf8');
const product = JSON.parse(productJson);

// Read the Positron version
const version = product.positronVersion;

// Check to see whether there's already a file with this version's name
const anchorPath = path.resolve(__dirname, version + '.commit');
if (!fs.existsSync(anchorPath)) {
    console.log(`Anchor file ${anchorPath} does not exist for version ${version}. If this is a new version, you can create it with create-anchor.js.`);
    process.exit(1);
}

// Read the commit from the anchor file
const commit = fs.readFileSync(anchorPath, 'utf8').trim();

// Compute the distance from the anchor commit to the current commit
const head = child_process.execSync('git rev-parse --short HEAD').toString().trim();
const distance = child_process.execSync(`git rev-list --count ${commit}..${head}`).toString().trim();

// Process the command line arguments
if (process.argv.includes('--version')) {
    // Just the version number from product.json
    console.log(version);
} else if (process.argv.includes('--build')) {
    // Just the build number (used by build scripts)
    console.log(distance);
} else if (process.argv.includes('--short')) {
    // Short version number
    console.log(`${version}-${distance}`);
} else {
    // The full version number, including the build number
    console.log(`${version} build ${distance} (${head})`);
}

