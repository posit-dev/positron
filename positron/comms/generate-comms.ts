/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is a code generator that parses OpenRPC specificationos and generates
 * Typescript, Rust, and Python code for each of the comms defined in this
 * directory.
 *
 * See the README.md file in this directory for more information.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { compile } from 'json-schema-to-typescript';
import { execSync } from 'child_process';
import path, { format } from 'path';

const commsDir = `${__dirname}`;
const commsFiles = readdirSync(commsDir);

/// The directory to write the generated Typescript files to
const tsOutputDir = `${__dirname}/../../src/vs/workbench/services/languageRuntime/common`;

/// The directory to write the generated Rust files to (note that this presumes
/// that the amalthea repo is cloned into the same parent directory as the
/// positron repo)
const rustOutputDir = `${__dirname}/../../../amalthea/crates/amalthea/src/comm`;

/// The directory to write the generated Python files to
const pythonOutputDir = `${__dirname}/../../extensions/positron-python/pythonFiles/positron`;

const comms = new Array<string>();

const year = new Date().getFullYear();

interface CommMetadata {
	name: string;
	initiator: 'frontend' | 'backend';
	initial_data: {
		schema: any;
	};
}

// Maps from JSON schema types to Typescript types
const TypescriptTypeMap: Record<string, string> = {
	'boolean': 'boolean',
	'integer': 'number',
	'number': 'number',
	'string': 'string',
	'null': 'null',
	'array': 'Array',
	'object': 'object',
};

// Maps from JSON schema types to Rust types
const RustTypeMap: Record<string, string> = {
	'boolean': 'bool',
	'integer': 'i64',
	'number': 'f64',
	'string': 'String',
	'null': 'null',
	'array': 'Vec',
	'object': 'HashMap',
};

// Maps from JSON schema types to Python types
const PythonTypeMap: Record<string, string> = {
	'boolean': 'bool',
	'integer': 'int',
	'number': 'float',
	'string': 'str',
	'null': 'null',
	'array': 'List',
	'object': 'Dict',
};

/**
 * Converter from snake_case to camelCase
 *
 * @param name A snake_case name
 * @returns A camelCase name
 */
function snakeCaseToCamelCase(name: string) {
	return name.replace(/_([a-z])/g, (m) => m[1].toUpperCase());
}

/**
 * Converter from snake_case to SentenceCase
 *
 * @param name A snake_case name
 * @returns A SentenceCase name
 */
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

/**
 * Formats a comment, breaking it into multiple lines and adding a leader to
 * each line.
 *
 * @param leader The leader to use for each line
 * @param comment The comment to format
 * @returns The formatted comment
 */
function formatComment(leader: string, comment: string): string {
	const lines = formatLines(comment);
	let result = '';
	for (const line of lines) {
		result += leader + line + '\n';
	}
	return result;
}

function* createRustComm(name: string, frontend: any, backend: any): Generator<string> {
	yield `/*---------------------------------------------------------------------------------------------
 *  Copyright (C) ${year} Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ${name}.json; do not edit.
//

use serde::Deserialize;
use serde::Serialize;

`;

	if (backend) {
		// Create objects for all the object schemas first
		for (const method of backend.methods) {
			if (method.result &&
				method.result.schema &&
				method.result.schema.type === 'object') {
				yield '#[derive(Debug, Serialize, Deserialize, PartialEq)]\n';
				yield `pub struct ${snakeCaseToSentenceCase(method.result.schema.name)} {\n`;
				const props = Object.keys(method.result.schema.properties);
				for (let i = 0; i < props.length; i++) {
					const prop = props[i];
					const schema = method.result.schema.properties[prop];
					if (schema.description) {
						yield formatComment('\t/// ', schema.description);
					}
					yield `\tpub ${prop}: ${RustTypeMap[schema.type]},\n`;
					if (i < props.length - 1) {
						yield '\n';
					}
				}
				yield '}\n\n';
			}
		}
	}

	// Create enums for all enum types
	for (const source of [backend, frontend]) {
		if (!source) {
			continue;
		}
		for (const method of source.methods) {
			for (const param of method.params) {
				if (param.schema.enum) {
					yield formatComment(`/// `,
						`Possible values for the ` +
						snakeCaseToSentenceCase(param.name) + ` ` +
						`parameter of the ` +
						snakeCaseToSentenceCase(method.name) + ` ` +
						`method.`);
					yield '#[derive(Debug, Serialize, Deserialize, PartialEq)]\n';
					yield `pub enum ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)} {\n`;
					for (let i = 0; i < param.schema.enum.length; i++) {
						const value = param.schema.enum[i];
						yield `\t#[serde(rename = "${value}")]\n`;
						yield `\t${snakeCaseToSentenceCase(value)}`;
						if (i < param.schema.enum.length - 1) {
							yield ',\n\n';
						} else {
							yield '\n';
						}
					}
					yield '}\n\n';
				}
			}
		}
	}

	for (const source of [backend, frontend]) {
		if (!source) {
			continue;
		}
		for (const method of source.methods) {
			if (method.params.length > 0) {
				yield formatComment(`/// `,
					`Parameters for the ` +
					snakeCaseToSentenceCase(method.name) + ` ` +
					`method.`);
				yield '#[derive(Debug, Serialize, Deserialize, PartialEq)]\n';
				yield `pub struct ${snakeCaseToSentenceCase(method.name)}Params {\n`;
				for (let i = 0; i < method.params.length; i++) {
					const param = method.params[i];
					if (param.description) {
						yield formatComment('\t/// ', param.description);
					}
					if (param.schema.enum) {
						// Use an enum type if the schema has an enum
						yield `\tpub ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)},\n`;
					} else {
						// Otherwise use the type directly
						yield `\tpub ${param.name}: ${RustTypeMap[param.schema.type]},\n`;
					}
					if (i < method.params.length - 1) {
						yield '\n';
					}
				}
				yield `}\n\n`;
			}
		}
	}

	if (backend) {
		yield '/**\n';
		yield ` * RPC request types for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "params")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}RpcRequest {\n`;
		for (const method of backend.methods) {
			if (method.summary) {
				yield formatComment('\t/// ', method.summary);
				if (method.description) {
					yield '\t///\n';
					yield formatComment('\t/// ', method.description);
				}
			}
			yield `\t#[serde(rename = "${method.name}")]\n`;
			yield `\t${snakeCaseToSentenceCase(method.name)}`;
			if (method.params.length > 0) {
				yield `(${snakeCaseToSentenceCase(method.name)}Params),\n`;
			} else {
				yield ',\n';
			}
		}
		yield `}\n\n`;

		yield '/**\n';
		yield ` * RPC Reply types for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "result")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}RpcReply {\n`;
		for (const method of backend.methods) {
			if (method.result.schema) {
				const schema = method.result.schema;
				if (schema.description) {
					yield formatComment('\t/// ', schema.description);
				}
				yield `\t${snakeCaseToSentenceCase(method.name)}Reply`;
				if (schema.type === 'object') {
					yield `(${snakeCaseToSentenceCase(schema.name)}),\n`;
				} else {
					yield `(${RustTypeMap[schema.type]}),\n`;
				}
			}
		}
		yield `}\n\n`;
	}

	if (frontend) {
		yield '/**\n';
		yield ` * Front-end events for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "params")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}Event {\n`;
		for (const method of frontend.methods) {
			yield `\t#[serde(rename = "${method.name}")]\n`;
			yield `\t${snakeCaseToSentenceCase(method.name)}`;
			if (method.params.length > 0) {
				yield `(${snakeCaseToSentenceCase(method.name)}Params),\n`;
			} else {
				yield ',\n';
			}
		}
		yield `}\n\n`;
	}
}

function* createPythonComm(name: string, frontend: any, backend: any): Generator<string> {
	yield `#
#  Copyright (C) ${year} Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from ${name}.json; do not edit.
#

import enum
from dataclasses import dataclass, field

`;

	if (backend) {
		// Create classes for all the object schemas first
		for (const method of backend.methods) {
			if (method.result &&
				method.result.schema &&
				method.result.schema.type === 'object') {
				yield '@dataclass\n';
				yield `class ${snakeCaseToSentenceCase(method.result.schema.name)}:\n`;
				if (method.result.schema.description) {
					yield '    """\n';
					yield formatComment('    ', method.result.schema.description);
					yield '    """\n';
					yield '\n';
				}
				for (const prop of Object.keys(method.result.schema.properties)) {
					const schema = method.result.schema.properties[prop];
					yield `    ${prop}: ${PythonTypeMap[schema.type]}`;
					yield ' = field(\n';
					yield `        metadata={\n`;
					yield `            "description": "${schema.description}",\n`;
					yield `        }\n`;
					yield `    )\n\n`;
				}
				yield '\n\n';
			}
		}
	}

	// Create enums for all enum types
	for (const source of [backend, frontend]) {
		if (!source) {
			continue;
		}
		for (const method of source.methods) {
			for (const param of method.params) {
				if (param.schema.enum) {
					yield '@enum.unique\n';
					yield `class ${snakeCaseToSentenceCase(method.name)}`;
					yield `${snakeCaseToSentenceCase(param.name)}(str, enum.Enum):\n`;
					yield '    """\n';
					yield formatComment(`    `,
						`Possible values for the ` +
						snakeCaseToSentenceCase(param.name) + ` ` +
						`parameter of the ` +
						snakeCaseToSentenceCase(method.name) + ` ` +
						`method.`);
					yield '    """\n';
					yield '\n';
					for (let i = 0; i < param.schema.enum.length; i++) {
						const value = param.schema.enum[i];
						yield `    ${snakeCaseToSentenceCase(value)} = "${value}"`;
						if (i < param.schema.enum.length - 1) {
							yield '\n\n';
						} else {
							yield '\n';
						}
					}
					yield '\n\n';
				}
			}
		}
	}

	if (backend) {
		yield '@enum.unique\n';
		yield `class ${snakeCaseToSentenceCase(name)}Request(str, enum.Enum):\n`;
		yield `    """\n`;
		yield `    An enumeration of all the possible requests that can be sent to the ${name} comm.\n`;
		yield `    """\n`;
		yield `\n`;
		for (const method of backend.methods) {
			if (method.result) {
				yield formatComment('    # ', method.summary);
				yield `    ${snakeCaseToSentenceCase(method.name)} = "${method.name}"\n`;
				yield '\n';
			}
		}
	}

	if (backend) {
		for (const method of backend.methods) {
			yield `@dataclass\n`;
			yield `class ${snakeCaseToSentenceCase(method.name)}Params:\n`;
			yield `    """\n`;
			yield formatComment('    ', method.description);
			yield `    """\n`;
			yield `\n`;
			for (const param of method.params) {
				if (param.schema.enum) {
					yield `    ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
				} else {
					yield `    ${param.name}: ${PythonTypeMap[param.schema.type]}`;
				}
				yield ' = field(\n';
				yield `        metadata={\n`;
				yield `            "description": "${param.description}",\n`;
				yield `        }\n`;
				yield `    )\n\n`;
			}

			yield `@dataclass\n`;
			yield `class ${snakeCaseToSentenceCase(method.name)}Request:\n`;
			yield `    """\n`;
			yield formatComment('    ', method.description);
			yield `    """\n`;
			yield `\n`;
			yield `    def __post_init__(self):\n`;
			yield `        """ Revive RPC parameters after initialization """\n`;
			yield `        if isinstance(self.params, dict):\n`;
			yield `             self.params = `;
			yield `${snakeCaseToSentenceCase(method.name)}Params(**self.params)\n`;
			yield `\n`;
			yield `    params: ${snakeCaseToSentenceCase(method.name)}Params = field(\n`;
			yield `        metadata={\n`;
			yield `            "description": "Parameters to the ${snakeCaseToSentenceCase(method.name)} method"\n`;
			yield `        }\n`;
			yield `    )\n`;
			yield `\n`;
			yield `    method: ${snakeCaseToSentenceCase(name)}Request = field(\n`;
			yield `        metadata={\n`;
			yield `            "description": "The JSON-RPC method name (${method.name})"\n`;
			yield `        },\n`;
			yield `        default=`;
			yield `${snakeCaseToSentenceCase(name)}Request.${snakeCaseToSentenceCase(method.name)}\n`;
			yield `    )\n`;
			yield '\n';
			yield `    jsonrpc: str = field(\n`;
			yield `        metadata={\n`;
			yield `            "description": "The JSON-RPC version specifier"\n`;
			yield `        },\n`;
			yield `        default="2.0"`;
			yield `    )\n`;
			yield `\n`;
		}
	}


	if (frontend) {
		yield `@enum.unique\n`;
		yield `class ${snakeCaseToSentenceCase(name)}Event(str, enum.Enum):\n`;
		yield `    """\n`;
		yield `    An enumeration of all the possible events that can be sent from the ${name} comm.\n`;
		yield `    """\n`;
		yield `\n`;
		for (const method of frontend.methods) {
			yield formatComment('    # ', method.summary);
			yield `    ${snakeCaseToSentenceCase(method.name)} = "${method.name}"\n`;
			yield '\n';
		}

		for (const method of frontend.methods) {
			if (method.params.length > 0) {
				yield `@dataclass\n`;
				yield `class ${snakeCaseToSentenceCase(method.name)}Params:\n`;
				yield `    """\n`;
				yield formatComment('    ', method.summary);
				yield `    """\n`;
				yield `\n`;
				for (const param of method.params) {
					if (param.schema.enum) {
						yield `    ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
					} else {
						yield `    ${param.name}: ${PythonTypeMap[param.schema.type]}`;
					}
					yield ' = field(\n';
					yield `        metadata={\n`;
					yield `            "description": "${param.description}"\n`;
					yield `        }\n`;
					yield `    )\n\n`;
				}
			}
		}
	}
}

async function* createTypescriptComm(name: string, frontend: any, backend: any): AsyncGenerator<string> {
	// Read the metadata file
	const metadata: CommMetadata = JSON.parse(
		readFileSync(path.join(commsDir, `${name}.json`), { encoding: 'utf-8' }));
	yield `/*---------------------------------------------------------------------------------------------
 *  Copyright (C) ${year} Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ${name}.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

`;

	if (backend) {
		// Create interfaces for all the object schemas first
		for (const method of backend.methods) {
			if (method.result &&
				method.result.schema &&
				method.result.schema.type === 'object') {
				yield await compile(method.result.schema,
					method.result.schema.name, {
					bannerComment: '',
					additionalProperties: false,
					style: {
						useTabs: true
					}
				});
				yield '\n';
			}
		}
	}

	if (frontend) {
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating event types here
			if (method.result) {
				continue;
			}
			yield '/**\n';
			yield formatComment(' * ', `Event: ${method.summary}`);
			yield ' */\n';
			yield `export interface ${snakeCaseToSentenceCase(method.name)}Event {\n`;
			for (const param of method.params) {
				yield '\t/**\n';
				yield formatComment('\t * ', `${param.description}`);
				yield '\t */\n';
				yield `\t${snakeCaseToCamelCase(param.name)}: `;
				if (param.schema.type === 'string' && param.schema.enum) {
					yield param.schema.enum.map((value: string) => `'${value}'`).join(' | ');
				} else {
					yield TypescriptTypeMap[param.schema.type as string];
				}
				yield `;\n\n`;
			}
			yield '}\n\n';
		}
	}

	yield `export class Positron${snakeCaseToSentenceCase(name)}Comm extends PositronBaseComm {\n`;

	// TODO: supply initial data
	yield '\tconstructor(instance: IRuntimeClientInstance<any, any>) {\n';
	yield '\t\tsuper(instance);\n';
	if (frontend) {
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating events here
			if (method.result) {
				continue;
			}
			yield `\t\tthis.onDid${snakeCaseToSentenceCase(method.name)} = `;
			yield `super.createEventEmitter('${method.name}', [`;
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				yield `'${param.name}'`;
				if (i < method.params.length - 1) {
					yield ', ';
				}
			}
			yield `]);\n`;
		}
	}

	yield '\t}\n\n';

	if (backend) {
		// Then create all the methods
		for (const method of backend.methods) {
			// Write the comment header
			yield '\t/**\n';
			yield formatComment('\t * ', method.summary);
			if (method.description) {
				yield `\t *\n`;
				yield formatComment('\t * ', method.description);
			}
			yield `\t *\n`;
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				yield formatComment('\t * ',
					`@param ${snakeCaseToCamelCase(param.name)} ${param.description}`);
			}
			yield `\t *\n`;
			if (method.result) {
				yield formatComment('\t * ',
					`@returns ${method.result.schema.description}`);
			}
			yield '\t */\n';
			yield '\t' + snakeCaseToCamelCase(method.name) + '(';
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				yield snakeCaseToCamelCase(param.name) +
					': ' +
					TypescriptTypeMap[param.schema.type as string];
				if (i < method.params.length - 1) {
					yield ', ';
				}
			}
			yield '): Promise<';
			if (method.result) {
				if (method.result.schema.type === 'object') {
					yield snakeCaseToSentenceCase(method.result.schema.name);
				} else {
					yield TypescriptTypeMap[method.result.schema.type as string];
				}
			}
			yield '> {\n';
			yield '\t\treturn super.performRpc(\'' + method.name + '\', [';
			for (let i = 0; i < method.params.length; i++) {
				yield `'${method.params[i].name}'`;
				if (i < method.params.length - 1) {
					yield ', ';
				}
			}
			yield '], [';
			for (let i = 0; i < method.params.length; i++) {
				yield snakeCaseToCamelCase(method.params[i].name);
				if (i < method.params.length - 1) {
					yield ', ';
				}
			}
			yield ']);\n';
			yield `\t}\n`;
		}
	}

	if (frontend) {
		yield '\n';
		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating events here
			if (method.result) {
				continue;
			}
			yield '\t/**\n';
			yield formatComment('\t * ', method.summary);
			if (method.description) {
				yield `\t *\n`;
				yield formatComment('\t * ', method.description);
			}
			yield '\t */\n';
			yield `\tonDid${snakeCaseToSentenceCase(method.name)}: `;
			yield `Event<${snakeCaseToSentenceCase(method.name)}Event>;\n`;
		}
	}

	yield `}\n\n`;
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

			// Create the Typescript output file
			const tsOutputFile = path.join(tsOutputDir, `positron${snakeCaseToSentenceCase(name)}Comm.ts`);
			let ts = '';
			for await (const chunk of createTypescriptComm(name, frontend, backend)) {
				ts += chunk;
			}

			// Write the output file
			writeFileSync(tsOutputFile, ts, { encoding: 'utf-8' });

			// Write to stdout too
			console.log(ts);

			// Create the Rust output file
			const rustOutputFile = path.join(rustOutputDir, `${name}_comm.rs`);
			let rust = '';
			for await (const chunk of createRustComm(name, frontend, backend)) {
				rust += chunk;
			}

			// Write the output file
			writeFileSync(rustOutputFile, rust, { encoding: 'utf-8' });

			// Write to stdout too
			console.log(rust);

			// Create the Python output file
			const pythonOutputFile = path.join(pythonOutputDir, `${name}_comm.py`);
			let python = '';
			for await (const chunk of createPythonComm(name, frontend, backend)) {
				python += chunk;
			}

			// Write the output file
			writeFileSync(pythonOutputFile, python, { encoding: 'utf-8' });

			// Write to stdout too
			console.log(python);

			// Use black to format the Python file; the lint tests for the
			// Python extension require that the Python files have exactly the
			// format that black produces.
			execSync(`python3 -m black ${pythonOutputFile}`);

			comms.push(name);
		}
	}
}

// Check prerequisites

// Check that the amalthea repo is cloned
if (!existsSync(rustOutputDir)) {
	console.error('The amalthea repo must be cloned into the same parent directory as the ' +
		'Positron rep, so that Rust output types can be written.');
	process.exit(1);
}

// Check that the Python module 'black' is installed by running Python
// and importing it
try {
	execSync('python3 -m black --version');
} catch (e) {
	console.error('The Python module "black" must be installed to run this script; it is ' +
		'required to properly format the Python output.');
	process.exit(1);
}

createCommInterface();
