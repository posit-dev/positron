/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, writeFileSync, readdirSync } from 'fs';

function renderSyntax(inputFile: string) {

	// Read input file as JSON
	const inputContents = readFileSync(inputFile, { encoding: 'utf-8' });
	const inputJson = JSON.parse(inputContents);

	// Replace template variables
	let outputContents = inputContents;
	const vars = inputJson['variables'];
	for (const [key, value] of Object.entries(vars)) {
		const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
		outputContents = outputContents.replace(pattern, value as string);
	}

	// Write the replaced content
	const outputFile = inputFile.replace('src.json', 'gen.json');
	writeFileSync(outputFile, outputContents, { encoding: 'utf-8' });

	// Write some output
	console.log(`[i] Generated '${inputFile}' => '${outputFile}'`);

}

// Look for syntax files in the 'syntaxes' folder
const syntaxFiles = readdirSync('syntaxes', { encoding: 'utf-8' });
for (const syntaxFile of syntaxFiles) {
	if (syntaxFile.indexOf('src.json') !== -1) {
		renderSyntax(`syntaxes/${syntaxFile}`);
	}
}

