/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { compile } from 'json-schema-to-typescript';
import path, { format } from 'path';

// Read the contents of the sibling "comms" directory
const commsDir = `${__dirname}/../comms`;
const commsFiles = readdirSync(commsDir);

const outputDir = `${__dirname}/../../src/vs/workbench/services/languageRuntime/common`;

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

// Breaks a single line of text into multiple lines, each of which is no longer than
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

function formatComment(leader: string, comment: string): string {
	const lines = formatLines(comment);
	let result = '';
	for (const line of lines) {
		result += leader + line + '\n';
	}
	return result;
}

async function createComm(name: string): Promise<string> {
	// Read the metadata file
	const metadata: CommMetadata = JSON.parse(
		readFileSync(path.join(commsDir, `${name}.json`), { encoding: 'utf-8' }));
	let output = `/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ${name}.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

`;

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
				output += await compile(method.result.schema,
					method.result.schema.name, {
					bannerComment: '',
					additionalProperties: false,
					style: {
						useTabs: true
					}
				});
				output += '\n';
			}
		}
	}

	if (frontend) {
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating event types here
			if (method.result) {
				continue;
			}
			output += '/**\n';
			output += formatComment(' * ', `Event: ${method.summary}`);
			output += ' */\n';
			output += `export interface ${snakeCaseToSentenceCase(method.name)}Event {\n`;
			for (const param of method.params) {
				output += '\t/**\n';
				output += formatComment('\t * ', `${param.description}`);
				output += '\t */\n';
				output += `\t${snakeCaseToCamelCase(param.name)}: `;
				output += TypescriptTypeMap[param.schema.type as string];
				output += `;\n\n`;
			}
			output += '}\n\n';
		}
	}

	output += `export class Positron${snakeCaseToSentenceCase(name)}Comm extends PositronBaseComm {\n`;

	// TODO: supply initial data
	output += '\tconstructor(instance: IRuntimeClientInstance<any, any>) {\n';
	output += '\t\tsuper(instance);\n';
	if (frontend) {
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating events here
			if (method.result) {
				continue;
			}
			output += `\t\tthis.onDid${snakeCaseToSentenceCase(method.name)} = `;
			output += `super.createEventEmitter('${method.name}', [`;
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				output += `'${param.name}'`;
				if (i < method.params.length - 1) {
					output += ', ';
				}
			}
			output += `]);\n`;
		}
	}

	output += '\t}\n\n';

	if (backend) {
		// Then create all the methods
		for (const method of backend.methods) {
			// Write the comment header
			output += '\t/**\n';
			output += formatComment('\t * ', method.summary);
			if (method.description) {
				output += `\t *\n`;
				output += formatComment('\t * ', method.description);
			}
			output += `\t *\n`;
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				output +=
					formatComment('\t * ',
						`@param ${snakeCaseToCamelCase(param.name)} ${param.description}`);
			}
			output += `\t *\n`;
			if (method.result) {
				output += formatComment('\t * ',
					`@returns ${method.result.schema.description}`);
			}
			output += '\t */\n';
			output += '\t' + snakeCaseToCamelCase(method.name) + '(';
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				output += snakeCaseToCamelCase(param.name) +
					': ' +
					TypescriptTypeMap[param.schema.type as string];
				if (i < method.params.length - 1) {
					output += ', ';
				}
			}
			output += '): Promise<';
			if (method.result) {
				if (method.result.schema.type === 'object') {
					output += snakeCaseToSentenceCase(method.result.schema.name);
				} else {
					output += TypescriptTypeMap[method.result.schema.type as string];
				}
			}
			output += '> {\n';
			output += '\t\treturn super.performRpc(\'' + method.name + '\', [';
			for (let i = 0; i < method.params.length; i++) {
				output += `'${method.params[i].name}'`;
				if (i < method.params.length - 1) {
					output += ', ';
				}
			}
			output += '], [';
			for (let i = 0; i < method.params.length; i++) {
				output += snakeCaseToCamelCase(method.params[i].name);
				if (i < method.params.length - 1) {
					output += ', ';
				}
			}
			output += ']);\n';
			output += `\t}\n`;
		}
	}

	if (frontend) {
		output += '\n';
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating events here
			if (method.result) {
				continue;
			}
			output += '\t/**\n';
			output += formatComment('\t * ', method.summary);
			if (method.description) {
				output += `\t *\n`;
				output += formatComment('\t * ', method.description);
			}
			output += '\t */\n';
			output += `\tonDid${snakeCaseToSentenceCase(method.name)}: `;
			output += `Event<${snakeCaseToSentenceCase(method.name)}Event>;\n`;
		}
	}

	output += `}\n\n`;

	return output;
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

			// Create the output file
			const outputFile = path.join(outputDir, `positron${snakeCaseToSentenceCase(name)}Comm.ts`);
			const content = await createComm(name);

			// Write the output file
			writeFileSync(outputFile, content, { encoding: 'utf-8' });

			// Write to stdout too
			console.log(content);

			comms.push(name);
		}
	}
}

createCommInterface();
