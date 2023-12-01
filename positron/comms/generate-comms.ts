/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync } from 'fs';
import { compile } from 'json-schema-to-typescript'
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


async function createComm(name: string) {
	// Read the metadata file
	const metadata: CommMetadata = JSON.parse(
		readFileSync(path.join(commsDir, `${name}.json`), { encoding: 'utf-8' }));

	// Read the frontend file
	let frontend = null;
	if (existsSync(path.join(commsDir, `${name}-frontend-openrpc.json`))) {
		frontend = JSON.parse(
			readFileSync(path.join(commsDir, `${name}-frontend-openrpc.json`), { encoding: 'utf-8' }));

	}

	// Read the backend file
	let backend = null;
	if (existsSync(path.join(commsDir, `${name}-backend-openrpc.json`))) {
		backend = JSON.parse(
			readFileSync(path.join(commsDir, `${name}-backend-openrpc.json`), { encoding: 'utf-8' }));

	}

	console.log(`export class ${name}Comm extends PositronComm {`);
	console.log(await compile(metadata.initial_data.schema, name, { bannerComment: '' }));
	console.log(`}`);
}

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
		createComm(name);
		comms.push(name);
	}
}

console.log('found comms: ' + comms.join('\n'));
