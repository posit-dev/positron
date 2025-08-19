/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

// Import the formatter from the build directory
const formatter = require('../build/lib/formatter');

function formatFile(filePath) {
	try {
		// Resolve the file path relative to project root
		const resolvedPath = path.resolve(filePath);
		
		// Check if file exists
		if (!fs.existsSync(resolvedPath)) {
			console.error(`Error: File not found: ${filePath}`);
			return false;
		}

		// Read the file content
		const content = fs.readFileSync(resolvedPath, 'utf8');
		
		// Format the content using TypeScript's formatter
		const formatted = formatter.format(resolvedPath, content);
		
		// Write the formatted content back to the file
		fs.writeFileSync(resolvedPath, formatted);
		
		console.log(`Formatted: ${filePath}`);
		return true;
	} catch (error) {
		console.error(`Error formatting ${filePath}:`, error.message);
		return false;
	}
}

function main() {
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.log('Usage: node scripts/format.js <file1> [file2] [file3] ...');
		console.log('');
		console.log('Format TypeScript/JavaScript files using the project\'s TypeScript formatter.');
		console.log('This is the same formatter used by the pre-commit hook.');
		console.log('');
		console.log('Examples:');
		console.log('  node scripts/format.js src/vs/workbench/browser/workbench.ts');
		console.log('  node scripts/format.js src/**/*.ts src/**/*.js');
		process.exit(1);
	}

	let allSuccessful = true;
	
	for (const filePath of args) {
		const success = formatFile(filePath);
		if (!success) {
			allSuccessful = false;
		}
	}
	
	if (!allSuccessful) {
		process.exit(1);
	}
}

if (require.main === module) {
	main();
}
