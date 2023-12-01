/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync } from 'fs';
import { compile } from 'json-schema-to-typescript';
import path from 'path';

// Read the contents of the sibling "comms" directory
const commsDir = `${__dirname}/../comms`;
const commsFiles = readdirSync(commsDir);

const comms = new Array<string>();

interface CommMetadata {
	name: string;
	initiator: 'frontend' | 'backend';
	initial_data: {
		schema: any;
	};
}

const TypescriptTypeMap: Record<string, string> = {
	'boolean': 'boolean',
	'integer': 'number',
	'number': 'number',
	'string': 'string',
	'null': 'null',
	'array': 'Array',
	'object': 'object',
};

function snakeCaseToCamelCase(name: string) {
	return name.replace(/_([a-z])/g, (m) => m[1].toUpperCase());
}

function snakeCaseToSentenceCase(name: string) {
	return snakeCaseToCamelCase(name).replace(/^[a-z]/, (m) => m[0].toUpperCase());
}

// Breaks a single line of text into mutliple lines, each of which is no longer than
// 70 characters.
function formatLines(line: string): string[] {
	const words = line.split(' ');
	const lines = new Array<string>();
	let currentLine = '';
	for (const word of words) {
		if (currentLine.length + word.length + 1 > 70) {
			lines.push(currentLine);
			currentLine = word;
		} else {
			if (currentLine.length > 0) {
				currentLine += ' ';
			}
			currentLine += word;
		}
	}
	lines.push(currentLine);
	return lines;
}

async function createComm(name: string) {
	// Read the metadata file
	const metadata: CommMetadata = JSON.parse(
		readFileSync(path.join(commsDir, `${name}.json`), { encoding: 'utf-8' }));

	// Read the frontend file
	let frontend: any = null;
	if (existsSync(path.join(commsDir, `${name}-frontend-openrpc.json`))) {
		frontend = JSON.parse(
			readFileSync(path.join(commsDir, `${name}-frontend-openrpc.json`), { encoding: 'utf-8' }));

	}

	// Read the backend file
	let backend: any = null;
	if (existsSync(path.join(commsDir, `${name}-backend-openrpc.json`))) {
		backend = JSON.parse(
			readFileSync(path.join(commsDir, `${name}-backend-openrpc.json`), { encoding: 'utf-8' }));

	}

	if (backend) {
		// Create interfaces for all the object schemas first
		for (const method of backend.methods) {
			if (method.result &&
				method.result.schema &&
				method.result.schema.type === 'object') {
				process.stdout.write(await compile(method.result.schema, name + '_result', { bannerComment: '' }));
			}
		}
	}

	process.stdout.write(`export class ${snakeCaseToSentenceCase(name)}Comm extends PositronComm {\n`);

	if (backend) {
		// Then create all the methods
		for (const method of backend.methods) {
			// Write the comment header
			process.stdout.write('  /**\n');
			process.stdout.write(`   * ${method.summary}\n`);
			if (method.description) {
				process.stdout.write(`   *\n`);
				const lines = formatLines(method.description);
				for (const line of lines) {
					process.stdout.write(`   * ${line}\n`);
				}
			}
			process.stdout.write('   */\n');
			process.stdout.write('  ' + snakeCaseToCamelCase(method.name) + '(');
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				process.stdout.write(snakeCaseToCamelCase(param.name) +
					': ' +
					TypescriptTypeMap[param.schema.type as string]);
				if (i < method.params.length - 1) {
					process.stdout.write(', ');
				}
			}
			process.stdout.write('): Promise<');
			if (method.result) {
				if (method.result.schema.type === 'object') {
					process.stdout.write(snakeCaseToSentenceCase(method.result.schema.name));
				} else {
					process.stdout.write(TypescriptTypeMap[method.result.schema.type as string]);
				}
			}
			process.stdout.write('> {\n');
			process.stdout.write('    return super.performRpc(\'' + method.name + '\', ');
			for (let i = 0; i < method.params.length; i++) {
				process.stdout.write(snakeCaseToCamelCase(method.params[i].name));
				if (i < method.params.length - 1) {
					process.stdout.write(', ');
				}
			}
			process.stdout.write(');\n');
			process.stdout.write(`  }\n`);
		}
		process.stdout.write(`}\n`);
	}
}

async function createCommInterface() {
	for (const file of commsFiles) {
		// Ignore non-JSON files
		if (!file.endsWith('.json')) {
			continue;
		}

		// Get the basename of the file
		const name = file.replace(/\.json$/, '');

		// If there's a corresponding frontend and/or backend file, process the comm
		if (existsSync(path.join(commsDir, `${name}-frontend-openrpc.json`)) ||
			existsSync(path.join(commsDir, `${name}-backend-openrpc.json`))) {
			await createComm(name);
			comms.push(name);
		}
	}
}

createCommInterface();
