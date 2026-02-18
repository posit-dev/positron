/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import * as formatter from '../build/lib/formatter.ts';

function formatFile(filePath: string): boolean {
	try {
		const resolvedPath = path.resolve(filePath);

		if (!fs.existsSync(resolvedPath)) {
			console.error(`Error: File not found: ${filePath}`);
			return false;
		}

		const content = fs.readFileSync(resolvedPath, 'utf8');
		const formatted = formatter.format(resolvedPath, content);
		fs.writeFileSync(resolvedPath, formatted);

		console.log(`Formatted: ${filePath}`);
		return true;
	} catch (error: any) {
		console.error(`Error formatting ${filePath}:`, error.message);
		return false;
	}
}

const args = process.argv.slice(2);

if (args.length === 0) {
	console.log('Usage: node scripts/format.mts <file1> [file2] ...');
	console.log('');
	console.log('Format TypeScript/JavaScript files using the project\'s TypeScript formatter.');
	console.log('This is the same formatter used by the pre-commit hook.');
	process.exit(1);
}

let allSuccessful = true;

for (const filePath of args) {
	if (!formatFile(filePath)) {
		allSuccessful = false;
	}
}

if (!allSuccessful) {
	process.exit(1);
}
