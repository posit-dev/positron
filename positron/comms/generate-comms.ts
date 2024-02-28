/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is a code generator that parses OpenRPC specifications and generates
 * Typescript, Rust, and Python code for each of the comms defined in this
 * directory.
 *
 * See the README.md file in this directory for more information.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const commsDir = `${__dirname}`;
let comms = [...new Set(readdirSync(commsDir)
	.filter(file => file.endsWith('.json'))
	.map(file => resolveComm(file)))];

/// Optionally, user can specify one or more comms to target, such as "ui" or "variables".
/// To target the "ui" comm, any of the 3 associated files can be given, with or without '.json'.
const args = process.argv.slice(2).map(arg => resolveComm(arg));
if (args.length) {
	comms = comms.filter(comm => args.includes(comm));
}

if (comms.length === 0) {
	console.log(`
	  No comms to process! Possible reasons include:
	    * No files found in '${commsDir}'
	    * No matches for comm(s) specified via command line args
	`);
}

const commsFiles = comms.map(comm => comm + '.json');

/// The directory to write the generated Typescript files to
const tsOutputDir = `${__dirname}/../../src/vs/workbench/services/languageRuntime/common`;

/// The directory to write the generated Rust files to (note that this presumes
/// that the amalthea repo is cloned into the same parent directory as the
/// positron repo)
const rustOutputDir = `${__dirname}/../../../amalthea/crates/amalthea/src/comm`;

/// The directory to write the generated Python files to
const pythonOutputDir = `${__dirname}/../../extensions/positron-python/pythonFiles/positron`;

const year = new Date().getFullYear();

interface CommMetadata {
	name: string;
	initiator: 'frontend' | 'backend';
	initial_data: {
		schema: any;
	};
}

interface MethodParam {
	name: string;
	description: string;
	required?: boolean;
	schema: {
		type: string;
		enum?: string[];
		items?: any;
	};
}

// Maps from JSON schema types to Typescript types
const TypescriptTypeMap: Record<string, string> = {
	'boolean': 'boolean',
	'integer': 'number',
	'number': 'number',
	'string': 'string',
	'null': 'null',
	'array-begin': 'Array<',
	'array-end': '>',
	'object': 'object',
};

// Maps from JSON schema types to Rust types
const RustTypeMap: Record<string, string> = {
	'boolean': 'bool',
	'integer': 'i64',
	'number': 'f64',
	'string': 'String',
	'null': 'null',
	'array-begin': 'Vec<',
	'array-end': '>',
	'object': 'HashMap',
};

// Maps from JSON schema types to Python types
const PythonTypeMap: Record<string, string> = {
	'boolean': 'bool',
	'integer': 'int',
	'number': 'float',
	'string': 'str',
	'null': 'null',
	'array-begin': 'List[',
	'array-end': ']',
	'object': 'Dict',
};

function resolveComm(s: string) {
	return s
		.replace(/\.json$/, '')
		.replace(/-(back|front)end-openrpc$/, '');
}

/**
 * Converter from snake_case to camelCase. Also replaces some special characters
 *
 * @param name A snake_case name
 * @returns A camelCase name
 */
function snakeCaseToCamelCase(name: string) {
	name = name.replace(/=/g, 'Eq');
	name = name.replace(/!/g, 'Not');
	name = name.replace(/</g, 'Lt');
	name = name.replace(/>/g, 'Gt');
	name = name.replace(/[/]/g, '_');
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

/**
 * Parse a ref tag to get the name of the object referred to by the ref.
 *
 * @param ref The ref to parse
 * @param contract The OpenRPC contract that the ref is part of
 * @returns The name of the object referred to by the ref, as a SentenceCase
 * string, or undefined if the ref could not be parsed or found.
 */
function parseRefFromContract(ref: string, contract: any): string | undefined {
	// Split the ref into parts, and then walk the contract to find the
	// referenced object
	const parts = ref.split('/');
	let target = contract;
	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === '#') {
			continue;
		}
		if (Object.keys(target).includes(parts[i])) {
			target = target[parts[i]];
		} else {
			return undefined;
		}
	}
	return snakeCaseToSentenceCase(parts[parts.length - 1]);
}

/**
 * Parse a ref tag to get the name of the object referred to by the ref.
 * Searches all the given contracts for the ref; throws if the ref cannot be
 * found in any of the contracts.
 *
 * @param ref The ref to parse
 * @param contracts The OpenRPC contracts to search for the ref.
 * @returns The name of the object referred to by the ref.
 */
function parseRef(ref: string, contracts: Array<any>): string {
	for (const contract of contracts) {
		if (!contract) {
			continue;
		}
		const name = parseRefFromContract(ref, contract);
		if (name) {
			return name;
		}
	}
	throw new Error(`Could not find ref: ${ref}`);
}

/**
 * Generic function for deriving a type from a schema.
 *
 * @param contract The OpenRPC contracts
 * @param typeMap A map from schema types to language types
 * @param context An array of keys beneath which this schema is defined
 * @param schema The schema to derive a type from
 *
 * @returns A string containing the derived type
 */
function deriveType(contracts: Array<any>,
	typeMap: Record<string, string>,
	context: Array<string>,
	schema: any): string {
	if (schema.type === 'array') {
		// If the array has a ref, use that to derive an array type
		return typeMap['array-begin'] +
			deriveType(contracts, typeMap, context, schema.items) +
			typeMap['array-end'];
	} else if (schema.$ref) {
		return parseRef(schema.$ref, contracts);
	} else if (schema.type === 'object') {
		if (schema.name) {
			return snakeCaseToSentenceCase(schema.name);
		} else {
			return snakeCaseToSentenceCase(context[0]);
		}
	} else if (schema.type === 'string' && schema.enum) {
		if (context.length < 2) {
			throw new Error(`missing context (need at least 2 elements): ${context[0]}`);
		}
		return snakeCaseToSentenceCase(context[1]) +
			snakeCaseToSentenceCase(context[0]);
	} else {
		if (Object.keys(typeMap).includes(schema.type)) {
			return typeMap[schema.type];
		} else {
			throw new Error(`Unknown type: ${schema.type}`);
		}
	}
}

/**
 * Breaks a single line of text into multiple lines, each of which is no longer
 * than 70 characters.
 *
 * @param line The line to break
 * @returns An array of lines
 */
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

/**
 * Visitor function for enums in an OpenRPC contract. Recursively discovers all
 * enum values and calls the callback function for each enum.
 *
 * @param context The current context stack (names of objects leading to the enum)
 * @param contract The OpenRPC contract to visit
 * @param callback The callback function to call for each enum
 *
 * @returns An generator that yields the results of the callback function,
 * invoked for each enum
 */
function* enumVisitor(
	context: Array<string>,
	contract: any,
	callback: (context: Array<string>, e: Array<string>) => Generator<string>
): Generator<string> {
	if (contract.enum) {
		// If this object has an enum, call the callback function and yield the
		// result
		yield* callback(context, contract.enum);
	} else if (Array.isArray(contract)) {
		// If this object is an array, recurse into each item
		for (const item of contract) {
			yield* enumVisitor(context, item, callback);
		}
	} else if (typeof contract === 'object') {
		// If this object is an object, recurse into each property
		for (const key of Object.keys(contract)) {
			if (contract['name']) {
				// If this is a named object, push the name onto the context
				// and recurse
				yield* enumVisitor(
					[contract['name'], ...context], contract[key], callback);
			} else if (key === 'properties' || key === 'params') {
				// If this is a properties or params object, recurse into each
				// property, but don't push the parent name onto the context
				yield* enumVisitor(
					context, contract[key], callback);
			} else {
				// For all other objects, push the key onto the context and
				// recurse
				yield* enumVisitor(
					[key, ...context], contract[key], callback);
			}

		}
	}
}


/**
 * Visitor function for object definitions (i.e. schema type = "object") in an
 * OpenRPC contract. Recursively discovers all object definitions and invokes
 * the callback for each one.
 *
 * @param context The current context stack (names of keys leading to the object)
 * @param contract The OpenRPC contract to visit
 * @param callback The callback function to call for each object
 *
 * @returns An generator that yields the results of the callback function,
 * invoked for each object definition
 */
function* objectVisitor(
	context: Array<string>,
	contract: any,
	callback: (context: Array<string>, o: Record<string, any>) => Generator<string>
): Generator<string> {
	if (contract.type === 'object') {
		// This is an object definition, so call the callback function and yield
		// the result
		yield* callback(context, contract);

		// Keep recursing into the object definition to discover any nested
		// object definitions
		yield* objectVisitor(context, contract.properties, callback);
	} else if (Array.isArray(contract)) {
		// If this object is an array, recurse into each item
		for (const item of contract) {
			yield* objectVisitor(context, item, callback);
		}
	} else if (typeof contract === 'object') {
		// If this object is an object, recurse into each property
		for (const key of Object.keys(contract)) {
			if (key === 'schema') {
				yield* objectVisitor(context, contract[key], callback);
			}
			else {
				yield* objectVisitor(
					[key, ...context], contract[key], callback);
			}
		}
	}
}

/**
 * Create a Rust comm for a given OpenRPC contract.
 *
 * @param name The name of the comm
 * @param frontend The OpenRPC contract for the frontend
 * @param backend The OpenRPC contract for the backend
 *
 * @returns A generator that yields the Rust code for the comm
 */
function* createRustComm(name: string, frontend: any, backend: any): Generator<string> {
	yield `// @generated

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) ${year} Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ${name}.json; do not edit.
//

use serde::Deserialize;
use serde::Serialize;

`;

	const contracts = [backend, frontend];
	const namedContracts = [{ name: 'Backend', source: backend },
	{ name: 'Frontend', source: frontend }];

	for (const contract of namedContracts) {
		const source = contract.source;
		if (!source) {
			continue;
		}

		// Create type aliases for all the shared types
		if (source.components && source.components.schemas) {
			for (const key of Object.keys(source.components.schemas)) {
				const schema = source.components.schemas[key];
				if (schema.type !== 'object') {
					yield formatComment('/// ', schema.description);
					yield `type ${snakeCaseToSentenceCase(key)} = `;
					yield deriveType(contracts, RustTypeMap,
						[schema.name ? schema.name : key],
						schema);
					yield ';\n\n';
				}
			}
		}

		// Create structs for all object types
		yield* objectVisitor([], source, function* (context: Array<string>, o: Record<string, any>) {
			if (o.description) {
				yield formatComment('/// ', o.description);
			} else {
				yield formatComment('/// ',
					snakeCaseToSentenceCase(context[0]) + ' in ' +
					snakeCaseToSentenceCase(context[1]));
			}
			const name = o.name ? o.name : context[0] === 'items' ? context[1] : context[0];
			const props = Object.keys(o.properties);

			// Map "any" type to `Value`
			if (props.length === 0 && o.additionalProperties === true) {
				return yield `pub type ${snakeCaseToSentenceCase(name)} = serde_json::Value;\n\n`;
			}

			yield '#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n';
			yield `pub struct ${snakeCaseToSentenceCase(name)} {\n`;

			for (let i = 0; i < props.length; i++) {
				const key = props[i];
				const prop = o.properties[key];
				if (prop.description) {
					yield formatComment('\t/// ', prop.description);
				}
				yield `\tpub ${key}: `;
				if (!o.required || !o.required.includes(key)) {
					yield 'Option<';
					yield deriveType(contracts, RustTypeMap, [key, ...context], prop);
					yield '>';

				} else {
					yield deriveType(contracts, RustTypeMap, [key, ...context], prop);
				}
				if (i < props.length - 1) {
					yield ',\n';
				}
				yield '\n';
			}
			yield '}\n\n';
		});


		// Create enums for all enum types
		yield* enumVisitor([], source, function* (context: Array<string>, values: Array<string>) {
			yield formatComment(`/// `,
				`Possible values for ` +
				snakeCaseToSentenceCase(context[0]) + ` in ` +
				snakeCaseToSentenceCase(context[1]));
			yield '#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n';
			yield `pub enum ${snakeCaseToSentenceCase(context[1])}${snakeCaseToSentenceCase(context[0])} {\n`;
			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				yield `\t#[serde(rename = "${value}")]\n`;
				yield `\t${snakeCaseToSentenceCase(value)}`;
				if (i < values.length - 1) {
					yield ',\n\n';
				} else {
					yield '\n';
				}
			}
			yield '}\n\n';
		});
	}

	// Create parameter objects for each method
	for (const source of contracts) {
		if (!source) {
			continue;
		}
		for (const method of source.methods) {
			if (method.params.length > 0) {
				yield formatComment(`/// `,
					`Parameters for the ` +
					snakeCaseToSentenceCase(method.name) + ` ` +
					`method.`);
				yield '#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n';
				yield `pub struct ${snakeCaseToSentenceCase(method.name)}Params {\n`;
				for (let i = 0; i < method.params.length; i++) {
					const param = method.params[i];
					if (param.description) {
						yield formatComment('\t/// ', param.description);
					}
					if (param.schema.enum) {
						// Use an enum type if the schema has an enum
						yield `\tpub ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)},\n`;
					} else if (param.schema.type === 'object' && Object.keys(param.schema.properties).length === 0) {
						// Handle the "any" type
						yield `\tpub ${param.name}: serde_json::Value,\n`;
					} else {
						// Otherwise use the type directly
						yield `\tpub ${param.name}: ${deriveType(contracts, RustTypeMap, [param.name], param.schema)},\n`;
					}
					if (i < method.params.length - 1) {
						yield '\n';
					}
				}
				yield `}\n\n`;
			}
		}
	}

	// Create the RPC request and reply enums
	for (const contract of namedContracts) {
		const source = contract.source;
		if (!source) {
			continue;
		}
		yield '/**\n';
		yield ` * ${contract.name} RPC request types for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "params")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}${contract.name}Request {\n`;
		for (const method of source.methods) {
			if (!method.result) {
				continue;
			}
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
				yield `(${snakeCaseToSentenceCase(method.name)}Params),\n\n`;
			} else {
				yield ',\n\n';
			}
		}
		yield `}\n\n`;

		yield '/**\n';
		yield ` * ${contract.name} RPC Reply types for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "result")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}${contract.name}Reply {\n`;
		for (const method of source.methods) {
			if (method.result) {
				if (!method.result.schema) {
					yield formatComment('\t/// ', `Reply for the ${method.name} method (no result)`);
					yield `\t${snakeCaseToSentenceCase(method.name)}Reply(),\n\n`;
					continue;
				}

				const schema = method.result.schema;
				if (schema.description) {
					yield formatComment('\t/// ', schema.description);
				}
				yield `\t${snakeCaseToSentenceCase(method.name)}Reply`;

				// No enum parameter, close the variant and continue to next
				if (schema.type === 'null') {
					yield '(),\n\n';
					continue;
				}

				// Open enum parameter
				yield '(';

				if (method.result.required === false) {
					yield 'Option<';
				}

				if (schema.type === 'object') {
					yield snakeCaseToSentenceCase(schema.name);
				} else {
					yield deriveType(contracts, RustTypeMap, [schema.name], schema);
				}

				// Close `Option<>`
				if (method.result.required === false) {
					yield '>';
				}

				// Close enum parameter
				yield '),\n\n';
			}
		}
		yield `}\n\n`;
	}

	// Create the event enum
	if (frontend) {
		yield '/**\n';
		yield ` * Frontend events for the ${name} comm\n`;
		yield ' */\n';
		yield `#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]\n`;
		yield `#[serde(tag = "method", content = "params")]\n`;
		yield `pub enum ${snakeCaseToSentenceCase(name)}FrontendEvent {\n`;
		for (const method of frontend.methods) {
			if (method.result !== undefined) {
				continue;
			}
			if (method.description) {
				yield formatComment('\t/// ', method.description);
			}
			yield `\t#[serde(rename = "${method.name}")]\n`;
			yield `\t${snakeCaseToSentenceCase(method.name)}`;
			if (method.params.length > 0) {
				yield `(${snakeCaseToSentenceCase(method.name)}Params),\n\n`;
			} else {
				yield ',\n\n';
			}
		}
		yield `}\n\n`;
	}

	if (frontend && frontend.methods.some((method: any) => method.result && method.result.schema)) {
		const enumRequestType = `${snakeCaseToSentenceCase(name)}FrontendRequest`;
		const enumReplyType = `${snakeCaseToSentenceCase(name)}FrontendReply`;
		yield `/**
* Conversion of JSON values to frontend RPC Reply types
*/
pub fn ${name}_frontend_reply_from_value(
	reply: serde_json::Value,
	request: &${enumRequestType},
) -> anyhow::Result<${snakeCaseToSentenceCase(name)}FrontendReply> {
	match request {
`;
		for (const method of frontend.methods) {
			if (method.result) {
				const variantName = `${enumRequestType}::${snakeCaseToSentenceCase(method.name)}`;
				const replyVariantName = `${enumReplyType}::${snakeCaseToSentenceCase(method.name)}Reply`;

				const hasParams = method.params.length > 0;

				const schema = method.result.schema;
				const replyHasParams = schema && schema.type !== 'null';

				const variant = hasParams ? `${variantName}(_)` : variantName;

				yield `\t\t${variant} => Ok(${replyVariantName}`;

				// If reply has a parameter, unserialise it
				if (replyHasParams) {
					yield '(serde_json::from_value(reply)?)';
				} else {
					yield '()';
				}

				// Close Ok
				yield '),\n';
			}
		}
		yield '\t}\n';
		yield '}\n\n';
	}
}

/**
 * Create a Python comm for a given OpenRPC contract.
 *
 * @param name The name of the comm
 * @param frontend The OpenRPC contract for the frontend
 * @param backend The OpenRPC contract for the backend
 *
 * @returns A generator that yields the Python code for the comm
 */
function* createPythonComm(name: string,
	frontend: any,
	backend: any): Generator<string> {
	yield `#
# Copyright (C) ${year} Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from ${name}.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field

`;

	const models = Array<string>();

	const contracts = [backend, frontend];
	for (const source of contracts) {
		if (!source) {
			continue;
		}

		// Create type aliases for all the shared types
		if (source.components && source.components.schemas) {
			for (const key of Object.keys(source.components.schemas)) {
				const schema = source.components.schemas[key];
				if (schema.type !== 'object') {
					yield formatComment('# ', schema.description);
					yield `${snakeCaseToSentenceCase(key)} = `;
					yield deriveType(contracts, PythonTypeMap,
						[schema.name ? schema.name : key],
						schema);
					yield '\n\n';
				}
			}
		}

		// Create enums for all enum types
		yield* enumVisitor([], source, function* (context: Array<string>, values: Array<string>) {
			yield '@enum.unique\n';
			yield `class ${snakeCaseToSentenceCase(context[1])}`;
			yield `${snakeCaseToSentenceCase(context[0])}(str, enum.Enum):\n`;
			yield '    """\n';
			yield formatComment(`    `,
				`Possible values for ` +
				snakeCaseToSentenceCase(context[0]) +
				` in ` +
				snakeCaseToSentenceCase(context[1]));
			yield '    """\n';
			yield '\n';
			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				yield `    ${snakeCaseToSentenceCase(value)} = "${value}"`;
				if (i < values.length - 1) {
					yield '\n\n';
				} else {
					yield '\n';
				}
			}
			yield '\n\n';
		});

		// Create pydantic models for all object types
		yield* objectVisitor([], source, function* (
			context: Array<string>,
			o: Record<string, any>) {

			let name = o.name ? o.name : context[0] === 'items' ? context[1] : context[0];
			name = snakeCaseToSentenceCase(name);

			// Empty object specs map to `Any`
			const props = Object.keys(o.properties);
			if ((!props || !props.length) && o.additionalProperties === true) {
				return yield `${name} = Any\n`;
			}

			// Preamble
			models.push(name);
			yield `class ${name}(BaseModel):\n`;

			// Docstring
			if (o.description) {
				yield '    """\n';
				yield formatComment('    ', o.description);
				yield '    """\n';
				yield '\n';
			} else {
				yield '    """\n';
				yield formatComment('    ', snakeCaseToSentenceCase(context[0]) + ' in ' +
					snakeCaseToSentenceCase(context[1]));
				yield '    """\n';
				yield '\n';
			}

			// Fields
			for (const prop of Object.keys(o.properties)) {
				const schema = o.properties[prop];
				yield `    ${prop}: `;
				if (!o.required || !o.required.includes(prop)) {
					yield 'Optional[';
					yield deriveType(contracts, PythonTypeMap, [prop, ...context], schema);
					yield ']';
				} else {
					yield deriveType(contracts, PythonTypeMap, [prop, ...context], schema);
				}
				yield ' = Field(\n';
				if (!o.required || !o.required.includes(prop)) {
					yield `        default=None,\n`;
				}
				yield `        description="${schema.description}",\n`;
				yield `    )\n\n`;
			}
			yield '\n\n';
		});
	}

	if (backend) {
		yield '@enum.unique\n';
		yield `class ${snakeCaseToSentenceCase(name)}BackendRequest(str, enum.Enum):\n`;
		yield `    """\n`;
		yield `    An enumeration of all the possible requests that can be sent to the backend ${name} comm.\n`;
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
			if (!method.description) {
				throw new Error(`No description for '${method.name}'; please add a description to the schema`);
			}

			const params: Array<MethodParam> = method.params;

			if (params.length > 0) {
				const klass = `${snakeCaseToSentenceCase(method.name)}Params`;
				models.push(klass);
				yield `class ${klass}(BaseModel):\n`;
				yield `    """\n`;
				yield formatComment('    ', method.description);
				yield `    """\n`;
				yield `\n`;

				for (const param of params) {
					if (param.schema.enum) {
						yield `    ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
					} else {
						yield `    ${param.name}: ${deriveType(contracts, PythonTypeMap, [param.name], param.schema)}`;
					}
					yield ' = Field(\n';
					yield `        description="${param.description}",\n`;
					yield `    )\n\n`;
				}
			}

			const klass = `${snakeCaseToSentenceCase(method.name)}Request`;
			models.push(klass);
			yield `class ${klass}(BaseModel):\n`;
			yield `    """\n`;
			yield formatComment('    ', method.description);
			yield `    """\n`;
			yield `\n`;
			if (method.params.length > 0) {
				yield `    params: ${snakeCaseToSentenceCase(method.name)}Params = Field(\n`;
				yield `        description="Parameters to the ${snakeCaseToSentenceCase(method.name)} method",\n`;
				yield `    )\n`;
				yield `\n`;
			}
			yield `    method: Literal[${snakeCaseToSentenceCase(name)}BackendRequest.${snakeCaseToSentenceCase(method.name)}] = Field(\n`;
			yield `        description="The JSON-RPC method name (${method.name})",\n`;
			yield `    )\n`;
			yield '\n';
			yield `    jsonrpc: str = Field(\n`;
			yield `        default="2.0",`;
			yield `        description="The JSON-RPC version specifier",\n`;
			yield `    )\n`;
			yield `\n`;
		}
	}

	// Create the backend message content class
	if (backend) {
		yield `class ${snakeCaseToSentenceCase(name)}BackendMessageContent(BaseModel):\n`;
		yield `    comm_id: str\n`;
		if (backend.methods.length === 1) {
			yield `    data: ${snakeCaseToSentenceCase(backend.methods[0].name)}Request`;
		} else {
			yield `    data: Union[\n`;
			for (const method of backend.methods) {
				yield `        ${snakeCaseToSentenceCase(method.name)}Request,\n`;
			}
			yield `    ] = Field(..., discriminator="method")\n`;
		}
		yield `\n`;
	}

	if (frontend) {
		yield `@enum.unique\n`;
		yield `class ${snakeCaseToSentenceCase(name)}FrontendEvent(str, enum.Enum):\n`;
		yield `    """\n`;
		yield `    An enumeration of all the possible events that can be sent to the frontend ${name} comm.\n`;
		yield `    """\n`;
		yield `\n`;
		for (const method of frontend.methods) {
			// Skip requests
			if (method.result) {
				continue;
			}
			yield formatComment('    # ', method.summary);
			yield `    ${snakeCaseToSentenceCase(method.name)} = "${method.name}"\n`;
			yield '\n';
		}

		for (const method of frontend.methods) {
			if (method.params.length > 0) {
				const klass = `${snakeCaseToSentenceCase(method.name)}Params`;
				models.push(klass);
				yield `class ${klass}(BaseModel):\n`;
				yield `    """\n`;
				yield formatComment('    ', method.summary);
				yield `    """\n`;
				yield `\n`;
				for (const param of method.params) {
					if (param.schema.enum) {
						yield `    ${param.name}: ${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
					} else {
						yield `    ${param.name}: ${deriveType(contracts, PythonTypeMap, [param.name], param.schema)}`;
					}
					yield ' = Field(\n';
					yield `        description="${param.description}",\n`;
					yield `    )\n\n`;
				}
			}
		}
	}
	for (const model of models) {
		yield `${model}.update_forward_refs()\n\n`;
	}
}

/**
 * Generates a Typescript interface for a given object schema.
 *
 * @param contract The OpenRPC contracts that the schema is part of
 * @param context An array of keys beneath which this schema is defined
 * @param name The name of the schema
 * @param description The description of the schema
 * @param properties The properties of the schema
 * @param required An array of required properties
 * @param additionalProperties Whether additional properties are allowed.
 * 	Currently only used for "any" objects.
 *
 * @returns A generator that yields the Typescript code for an interface
 * representing the schema
 */
function* createTypescriptInterface(
	contracts: Array<any>,
	context: Array<string>,
	name: string,
	description: string,
	properties: Record<string, any>,
	required: Array<string>,
	additionalProperties?: boolean,
): Generator<string> {

	if (!description) {
		throw new Error(`No description for '${name}'; please add a description to the schema`);
	}
	yield '/**\n';
	yield formatComment(' * ', description);
	yield ' */\n';
	yield `export interface ${snakeCaseToSentenceCase(name)} {\n`;
	if (!properties || Object.keys(properties).length === 0) {
		if (!additionalProperties) {
			throw new Error(`No properties for '${name}'; please add properties to the schema`);
		}

		// If `additionalProperties` is true, treat empty object specs as an "any" object
		yield '\t[k: string]: unknown;\n';
	}
	for (const prop of Object.keys(properties)) {
		const schema = properties[prop];
		if (!schema.description) {
			throw new Error(`No description for the '${name}.${prop}' value; please add a description to the schema`);
		}
		yield '\t/**\n';
		yield formatComment('\t * ', schema.description);
		yield '\t */\n';
		yield `\t${prop}`;
		if (!required.includes(prop)) {
			yield '?';
		}
		yield `: `;
		if (schema.type === 'object') {
			yield snakeCaseToSentenceCase(schema.name);
		} else if (schema.type === 'string' && schema.enum) {
			yield `${snakeCaseToSentenceCase(name)}${snakeCaseToSentenceCase(prop)}`;
		} else {
			yield deriveType(contracts, TypescriptTypeMap, [prop, ...context], schema);
		}
		yield `;\n\n`;
	}
	yield '}\n\n';
}

/**
 * Create a Typescript comm for a given OpenRPC contract.
 *
 * @param name The name of the comm
 * @param frontend The OpenRPC contract for the frontend
 * @param backend The OpenRPC contract for the backend
 */
function* createTypescriptComm(name: string, frontend: any, backend: any): Generator<string> {
	// Read the metadata file
	const metadata: CommMetadata = JSON.parse(
		readFileSync(path.join(commsDir, `${name}.json`), { encoding: 'utf-8' }));
	yield `/*---------------------------------------------------------------------------------------------
 *  Copyright (C) ${year} Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ${name}.json; do not edit.
//

`;
	// If there are frontend events, import the Event class
	if (frontend) {
		yield `import { Event } from 'vs/base/common/event';\n`;
	}
	yield `import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

`;
	const contracts = [backend, frontend];
	const namedContracts = [{ name: 'Backend', source: backend },
	{ name: 'Frontend', source: frontend }];

	for (const source of contracts) {
		if (!source) {
			continue;
		}
		yield* objectVisitor([], source,
			function* (context: Array<string>, o: Record<string, any>): Generator<string> {
				const name = o.name ? o.name : context[0] === 'items' ? context[1] : context[0];
				const description = o.description ? o.description :
					snakeCaseToSentenceCase(context[0]) + ' in ' +
					snakeCaseToSentenceCase(context[1]);
				const additionalProperties = o.additionalProperties ? o.additionalProperties : false;
				yield* createTypescriptInterface(contracts, context, name, description, o.properties,
					o.required ? o.required : [], additionalProperties);
			});

		// Create enums for all enum types
		yield* enumVisitor([], source, function* (context: Array<string>, values: Array<string>) {
			yield '/**\n';
			yield formatComment(` * `,
				`Possible values for ` +
				snakeCaseToSentenceCase(context[0]) + ` in ` +
				snakeCaseToSentenceCase(context[1]));
			yield ' */\n';
			yield `export enum ${snakeCaseToSentenceCase(context[1])}${snakeCaseToSentenceCase(context[0])} {\n`;
			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				yield `\t${snakeCaseToSentenceCase(value)} = '${value}'`;
				if (i < values.length - 1) {
					yield ',\n';
				} else {
					yield '\n';
				}
			}
			yield '}\n\n';
		});
	}

	for (const source of [backend, frontend]) {
		if (!source) {
			continue;
		}
		if (source.components && source.components.schemas) {
			for (const key of Object.keys(source.components.schemas)) {
				const schema = source.components.schemas[key];
				if (schema.type !== 'object') {
					yield `/**\n`;
					yield formatComment(' * ', schema.description);
					yield ' */\n';
					yield `export type ${snakeCaseToSentenceCase(key)} = `;
					yield deriveType(contracts, TypescriptTypeMap, [key], schema);
					yield ';\n\n';
				}
			}
		}
	}

	if (frontend) {
		const events: string[] = [];
		const requests: string[] = [];

		for (const method of frontend.methods) {
			// Ignore methods that have a result; we're generating event types here
			if (method.result) {
				continue;
			}

			// Collect enum fields
			const sentenceName = snakeCaseToSentenceCase(method.name);
			events.push(`\t${sentenceName} = '${method.name}'`);

			yield '/**\n';
			yield formatComment(' * ', `Event: ${method.summary}`);
			yield ' */\n';
			yield `export interface ${sentenceName}Event {\n`;
			for (const param of method.params) {
				yield '\t/**\n';
				yield formatComment('\t * ', `${param.description}`);
				yield '\t */\n';
				yield `\t${param.name}: `;
				if (param.schema.type === 'string' && param.schema.enum) {
					yield `${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
				} else {
					yield deriveType(contracts, TypescriptTypeMap, param.name, param.schema);
				}
				yield `;\n\n`;
			}
			yield '}\n\n';
		}

		for (const method of frontend.methods) {
			// Ignore methods that don't have a result; we're generating request types here
			if (!method.result) {
				continue;
			}

			// Collect enum fields
			const sentenceName = snakeCaseToSentenceCase(method.name);
			requests.push(`\t${sentenceName} = '${method.name}'`);

			yield '/**\n';
			yield formatComment(' * ', `Request: ${method.summary}`);
			yield formatComment(' *', '');
			yield formatComment(' * ', `${method.description}`);
			yield ' */\n';
			yield `export interface ${sentenceName}Request {\n`;
			for (const param of method.params) {
				yield '\t/**\n';
				yield formatComment('\t * ', `${param.description}`);
				yield '\t */\n';
				yield `\t${param.name}: `;
				if (param.schema.type === 'string' && param.schema.enum) {
					yield `${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
				} else {
					yield deriveType(contracts, TypescriptTypeMap, param.name, param.schema);
				}
				yield `;\n\n`;
			}
			yield '}\n\n';
		}

		if (events.length) {
			yield `export enum ${snakeCaseToSentenceCase(name)}FrontendEvent {\n`;
			yield events.join(',\n');
			yield '\n}\n\n';
		}

		if (requests.length) {
			yield `export enum ${snakeCaseToSentenceCase(name)}FrontendRequest {\n`;
			yield requests.join(',\n');
			yield '\n}\n\n';
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
			if (method.result && method.result.schema) {
				yield formatComment('\t * ',
					`@returns ${method.result.schema.description}`);
			}
			yield '\t */\n';
			yield '\t' + snakeCaseToCamelCase(method.name) + '(';
			for (let i = 0; i < method.params.length; i++) {
				const param = method.params[i];
				if (!param.schema) {
					throw new Error(`No schema for '${method.name}' parameter '${param.name}'`);
				}
				yield snakeCaseToCamelCase(param.name) + ': ';
				const schema = param.schema;
				if (schema.type === 'string' && schema.enum) {
					yield `${snakeCaseToSentenceCase(method.name)}${snakeCaseToSentenceCase(param.name)}`;
				} else {
					yield deriveType(contracts, TypescriptTypeMap, [method.name, param.name], schema);
				}
				if (i < method.params.length - 1) {
					yield ', ';
				}
			}
			yield '): Promise<';
			if (method.result && method.result.schema) {
				if (method.result.schema.type === 'object') {
					yield snakeCaseToSentenceCase(method.result.schema.name);
				} else {
					yield deriveType(contracts, TypescriptTypeMap, method.name, method.result.schema);
				}
			} else {
				yield 'void';
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
			yield `\t}\n\n`;
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

		try {
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
				console.log(`Writing to ${tsOutputFile}`);
				writeFileSync(tsOutputFile, ts, { encoding: 'utf-8' });

				// Create the Rust output file
				const rustOutputFile = path.join(rustOutputDir, `${name}_comm.rs`);
				let rust = '';
				for await (const chunk of createRustComm(name, frontend, backend)) {
					rust += chunk;
				}

				// Write the output file
				console.log(`Writing to ${rustOutputFile}`);
				writeFileSync(rustOutputFile, rust, { encoding: 'utf-8' });

				// Create the Python output file
				const pythonOutputFile = path.join(pythonOutputDir, `${name}_comm.py`);
				let python = '';
				for await (const chunk of createPythonComm(name, frontend, backend)) {
					python += chunk;
				}

				// Write the output file
				console.log(`Writing to ${pythonOutputFile}`);
				writeFileSync(pythonOutputFile, python, { encoding: 'utf-8' });

				// Use black to format the Python file; the lint tests for the
				// Python extension require that the Python files have exactly the
				// format that black produces.
				execSync(`python -m black ${pythonOutputFile}`, { stdio: 'ignore' });
			}
		} catch (e: any) {
			if (e.message) {
				e.message = `while processing ${name} comm:\n${e.message}`;
			}
			throw e;
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
