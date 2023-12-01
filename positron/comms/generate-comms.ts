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

	process.stdout.write(`export class ${name}Comm extends PositronComm {\n`);
	if (backend) {
		// Create interfaces for all the object schemas first
		for (const method of backend.methods) {
			if (method.result &&
				method.result.schema &&
				method.result.schema.type === 'object') {
				process.stdout.write(await compile(method.result.schema, name, { bannerComment: '' }));
			}
		}

		// Then create all the methods
		for (const method of backend.methods) {
			process.stdout.write('  ' + snakeCaseToCamelCase(method.name) + '(');
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				process.stdout.write(param.name + ': ' + TypescriptTypeMap[param.schema.type as string]);
				if (i < method.params.length - 1) {
					process.stdout.write(', ');
				}
			}
			process.stdout.write('): Promise<');
			if (method.result) {
				if (method.result.schema.type === 'object') {
					process.stdout.write(method.result.schema.name);
				} else {
					process.stdout.write(TypescriptTypeMap[method.result.schema.type as string]);
				}
			}
			process.stdout.write('>;\n');
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
